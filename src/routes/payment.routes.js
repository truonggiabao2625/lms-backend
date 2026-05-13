import express from 'express';
import Stripe from 'stripe';
import prisma from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { resolveMemberTier, formatCurrencyVnd, hasRequiredTier } from '../lib/membership.js';
import {
  creditWallet,
  creditWalletInTransaction,
  debitWalletForCoursePurchase,
  WalletOperationError,
} from '../lib/wallet.js';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_mock';
const stripe = new Stripe(stripeKey);

const ALLOWED_TOP_UP_AMOUNTS = [100000, 200000, 500000, 1000000];

const sanitizeTopUpAmount = (amount) => {
  const parsedAmount = Number(amount);
  return Number.isInteger(parsedAmount) ? parsedAmount : null;
};

const mapWalletErrorToResponse = (error, coursePrice = null) => {
  if (!(error instanceof WalletOperationError)) {
    throw error;
  }

  if (error.code === 'ALREADY_ENROLLED') {
    return { status: 400, body: { message: error.message } };
  }

  if (error.code === 'INSUFFICIENT_FUNDS') {
    return {
      status: 400,
      body: {
        message: error.message,
        requiredAmount: coursePrice ?? error.details.requiredAmount ?? 0,
        walletBalance: error.details.walletBalance ?? 0,
        shortfall: error.details.shortfall ?? 0,
      },
    };
  }

  if (error.code === 'INVALID_PRICE' || error.code === 'INVALID_AMOUNT') {
    return { status: 400, body: { message: error.message } };
  }

  return { status: 500, body: { message: 'Loi server khi xu ly vi noi bo' } };
};

const registerPendingExternalPayment = async ({ userId, amount, provider, providerSessionId, note = null }) => {
  return prisma.externalPayment.create({
    data: {
      userId,
      amount,
      provider,
      providerSessionId,
      note,
      status: 'PENDING',
    },
  });
};

const completeExternalPaymentAndCreditWallet = async ({
  providerEventId,
  sessionId,
  paymentIntentId = null,
  userId,
  amount,
  note,
}) => {
  return prisma.$transaction(async (tx) => {
    try {
      await tx.processedWebhookEvent.create({
        data: {
          provider: 'STRIPE',
          providerEventId,
          payload: { sessionId, paymentIntentId, userId, amount },
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        return { alreadyProcessed: true };
      }
      throw error;
    }

    let externalPayment = await tx.externalPayment.findUnique({
      where: { providerSessionId: sessionId },
    });

    if (!externalPayment) {
      externalPayment = await tx.externalPayment.create({
        data: {
          userId,
          amount,
          provider: 'STRIPE',
          providerSessionId: sessionId,
          providerPaymentIntentId: paymentIntentId,
          status: 'PENDING',
          note,
        },
      });
    }

    if (externalPayment.status !== 'COMPLETED') {
      externalPayment = await tx.externalPayment.update({
        where: { id: externalPayment.id },
        data: {
          status: 'COMPLETED',
          providerPaymentIntentId: paymentIntentId,
          completedAt: new Date(),
          note,
        },
      });
    }

    const updatedUser = await creditWalletInTransaction(tx, {
      userId,
      amount,
      note,
      externalPaymentId: externalPayment.id,
      source: 'stripe_webhook',
      idempotencyKey: providerEventId,
    });

    await tx.notification.create({
      data: {
        userId,
        type: 'PAYMENT_SUCCESS',
        title: 'Nap vi thanh cong',
        body: `Ban vua nap thanh cong ${formatCurrencyVnd(amount)} vao vi noi bo.`,
        link: '/pricing',
        metadata: { amount, externalPaymentId: externalPayment.id },
      },
    });

    return { alreadyProcessed: false, updatedUser };
  });
};

const purchaseCourseWithWallet = async ({ userId, courseId }) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    return { status: 404, body: { message: 'Khong tim thay khoa hoc' } };
  }

  if (!course.isPublished) {
    return { status: 400, body: { message: 'Khoa hoc nay dang o che do ban nhap' } };
  }

  if (course.price <= 0) {
    return { status: 400, body: { message: 'Khoa hoc nay mien phi, hay dang ky truc tiep.' } };
  }

  const userMembership = await prisma.user.findUnique({
    where: { id: userId },
    select: { memberTier: true },
  });

  if (!userMembership || !hasRequiredTier(userMembership.memberTier, course.minimumMemberTier)) {
    return {
      status: 403,
      body: {
        message: 'Danh hieu hoi vien hien tai chua du de mua khoa hoc nay',
        requiredTier: course.minimumMemberTier,
      },
    };
  }

  try {
    const result = await debitWalletForCoursePurchase({
      userId,
      course,
      note: `Mua khoa hoc: ${course.title}`,
      source: 'wallet_course_purchase',
      idempotencyKey: `course_purchase:${userId}:${courseId}`,
    });

    const nextTier = resolveMemberTier(result.totalSpent);

    return {
      status: 200,
      body: {
        message: 'Mua khoa hoc thanh cong',
        walletBalance: result.walletBalance,
        totalSpent: result.totalSpent,
        memberTier: result.memberTier,
        memberTierLabel: nextTier.label,
        successUrl: `${FRONTEND_URL}/course/${courseId}?success=true`,
      },
    };
  } catch (error) {
    return mapWalletErrorToResponse(error, course.price);
  }
};

router.post('/create-checkout-session', verifyToken, async (req, res) => {
  try {
    const { type, courseId, amount } = req.body;
    const userId = req.userId;

    if (type === 'course') {
      const result = await purchaseCourseWithWallet({ userId, courseId });
      return res.status(result.status).json(result.body);
    }

    if (type !== 'topup') {
      return res.status(400).json({ message: 'Loai giao dich khong hop le' });
    }

    const topUpAmount = sanitizeTopUpAmount(amount);
    if (!ALLOWED_TOP_UP_AMOUNTS.includes(topUpAmount)) {
      return res.status(400).json({ message: 'Menh gia nap vi khong hop le' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      return res.status(404).json({ message: 'Khong tim thay nguoi dung' });
    }

    if (stripeKey === 'sk_test_mock') {
      const mockSessionId = `mock_wallet_${Date.now()}`;

      const externalPayment = await prisma.externalPayment.create({
        data: {
          userId,
          amount: topUpAmount,
          provider: 'MOCK',
          providerSessionId: mockSessionId,
          note: `Nap vi test ${formatCurrencyVnd(topUpAmount)}`,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      await creditWallet({
        userId,
        amount: topUpAmount,
        note: `Nap vi test ${formatCurrencyVnd(topUpAmount)}`,
        externalPaymentId: externalPayment.id,
        source: 'mock_checkout',
        idempotencyKey: mockSessionId,
      });

      await prisma.notification.create({
        data: {
          userId,
          type: 'PAYMENT_SUCCESS',
          title: 'Nap vi thanh cong',
          body: `Ban vua nap thanh cong ${formatCurrencyVnd(topUpAmount)} vao vi noi bo.`,
          link: '/pricing',
          metadata: { amount: topUpAmount, externalPaymentId: externalPayment.id },
        },
      });

      return res.status(200).json({
        url: `${FRONTEND_URL}/payment-success?kind=topup&amount=${topUpAmount}&session_id=${mockSessionId}`,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'vnd',
            product_data: {
              name: `Nap vi noi bo ${formatCurrencyVnd(topUpAmount)}`,
            },
            unit_amount: topUpAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/payment-success?kind=topup&amount=${topUpAmount}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/payment-cancel?kind=topup`,
      metadata: {
        userId,
        type: 'topup',
        amount: String(topUpAmount),
      },
    });

    await registerPendingExternalPayment({
      userId,
      amount: topUpAmount,
      provider: 'STRIPE',
      providerSessionId: session.id,
      note: `Dang cho thanh toan nap vi ${formatCurrencyVnd(topUpAmount)}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Payment error:', error);
    return res.status(500).json({ message: 'Loi server khi xu ly giao dich' });
  }
});

export const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (endpointSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (error) {
    console.error('Webhook verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.send();
  }

  const session = event.data.object;
  const { userId, type, amount } = session.metadata || {};

  try {
    if (type === 'topup' && userId && amount) {
      await completeExternalPaymentAndCreditWallet({
        providerEventId: event.id,
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        userId,
        amount: Number(amount),
        note: `Nap vi thanh cong ${session.id}`,
      });
    }
  } catch (error) {
    console.error('Webhook database error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.send();
};

export default router;
