import prisma from './prisma.js';
import { resolveMemberTier } from './membership.js';

export class WalletOperationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WalletOperationError';
    this.code = code;
    this.details = details;
  }
}

const walletUserSelect = {
  id: true,
  walletBalance: true,
  totalSpent: true,
  memberTier: true,
};

const buildWalletMetadata = ({ source = null, idempotencyKey = null } = {}) => ({
  source,
  idempotencyKey,
});

export const creditWallet = async ({
  userId,
  amount,
  note,
  externalPaymentId = null,
  source = 'wallet_topup',
  idempotencyKey = null,
}) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new WalletOperationError('INVALID_AMOUNT', 'So tien nap vi khong hop le');
  }

  return prisma.$transaction(async (tx) => {
    return creditWalletInTransaction(tx, {
      userId,
      amount,
      note,
      externalPaymentId,
      source,
      idempotencyKey,
    });
  });
};

export const creditWalletInTransaction = async (
  tx,
  { userId, amount, note, externalPaymentId = null, source = 'wallet_topup', idempotencyKey = null }
) => {
  if (externalPaymentId) {
    const existingTransaction = await tx.walletTransaction.findFirst({
      where: { externalPaymentId },
      include: { user: { select: walletUserSelect } },
    });

    if (existingTransaction) {
      return existingTransaction.user;
    }
  }

  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: {
      walletBalance: {
        increment: amount,
      },
    },
    select: walletUserSelect,
  });

  await tx.walletTransaction.create({
    data: {
      userId,
      type: 'TOP_UP',
      amount,
      balanceAfter: updatedUser.walletBalance,
      note,
      externalPaymentId,
      metadata: buildWalletMetadata({ source, idempotencyKey }),
    },
  });

  return updatedUser;
};

export const debitWalletForCoursePurchase = async ({
  userId,
  course,
  note,
  source = 'wallet_purchase',
  idempotencyKey = null,
}) => {
  const coursePrice = Number(course.price);

  if (!Number.isInteger(coursePrice) || coursePrice <= 0) {
    throw new WalletOperationError('INVALID_PRICE', 'Gia khoa hoc khong hop le');
  }

  return prisma.$transaction(async (tx) => {
    const existingEnrollment = await tx.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId: course.id,
        },
      },
    });

    if (existingEnrollment) {
      throw new WalletOperationError('ALREADY_ENROLLED', 'Ban da dang ky khoa hoc nay roi');
    }

    const walletUpdate = await tx.user.updateMany({
      where: {
        id: userId,
        walletBalance: {
          gte: coursePrice,
        },
      },
      data: {
        walletBalance: {
          decrement: coursePrice,
        },
        totalSpent: {
          increment: coursePrice,
        },
      },
    });

    if (walletUpdate.count === 0) {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { walletBalance: true },
      });

      throw new WalletOperationError('INSUFFICIENT_FUNDS', 'So du vi khong du de mua khoa hoc nay', {
        requiredAmount: coursePrice,
        walletBalance: user?.walletBalance || 0,
        shortfall: Math.max(coursePrice - (user?.walletBalance || 0), 0),
      });
    }

    const updatedUser = await tx.user.findUnique({
      where: { id: userId },
      select: walletUserSelect,
    });

    if (!updatedUser) {
      throw new WalletOperationError('USER_NOT_FOUND', 'Khong tim thay nguoi dung');
    }

    const nextTier = resolveMemberTier(updatedUser.totalSpent);
    const memberTier =
      updatedUser.memberTier === nextTier.tier
        ? updatedUser.memberTier
        : (
            await tx.user.update({
              where: { id: userId },
              data: { memberTier: nextTier.tier },
              select: { memberTier: true },
            })
          ).memberTier;

    const purchase = await tx.purchase.create({
      data: {
        userId,
        courseId: course.id,
        originalAmount: coursePrice,
        discountAmount: 0,
        finalAmount: coursePrice,
        status: 'COMPLETED',
      },
    });

    await tx.enrollment.create({
      data: {
        userId,
        courseId: course.id,
        progress: 0,
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        courseId: course.id,
        purchaseId: purchase.id,
        type: 'COURSE_PURCHASE',
        amount: -coursePrice,
        balanceAfter: updatedUser.walletBalance,
        note,
        metadata: buildWalletMetadata({ source, idempotencyKey }),
      },
    });

    return {
      walletBalance: updatedUser.walletBalance,
      totalSpent: updatedUser.totalSpent,
      memberTier,
      purchaseId: purchase.id,
      coursePrice,
    };
  });
};
