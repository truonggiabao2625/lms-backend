import express from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { uploadAvatar, isCloudinaryConfigured } from '../lib/cloudinary.js';
import { resolveMemberTier, formatCurrencyVnd } from '../lib/membership.js';

const router = express.Router();

const parseSettings = (settings) => {
  if (!settings) {
    return {};
  }

  try {
    return JSON.parse(settings);
  } catch (error) {
    console.error('Settings parse error:', error);
    return {};
  }
};

const serializeUser = (user) => {
  const membership = resolveMemberTier(user.totalSpent);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    phone: user.phone,
    bio: user.bio,
    settings: parseSettings(user.settings),
    walletBalance: user.walletBalance,
    totalSpent: user.totalSpent,
    memberTier: user.memberTier,
    memberTierLabel: membership.label,
    memberTierMinSpent: membership.minSpent,
  };
};

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        phone: true,
        bio: true,
        settings: true,
        walletBalance: true,
        totalSpent: true,
        memberTier: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'Khong tim thay nguoi dung' });
    }

    res.status(200).json(serializeUser(user));
  } catch (error) {
    console.error('Fetch user error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.put('/me', verifyToken, async (req, res) => {
  try {
    const { name, phone, bio, settings } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(name && { name }),
        ...(phone !== undefined && { phone }),
        ...(bio !== undefined && { bio }),
        ...(settings !== undefined && { settings: JSON.stringify(settings) }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        phone: true,
        bio: true,
        settings: true,
        walletBalance: true,
        totalSpent: true,
        memberTier: true,
      },
    });

    res.status(200).json(serializeUser(updatedUser));
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.get('/billing-history', verifyToken, async (req, res) => {
  try {
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: req.userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
          },
        },
        purchase: {
          select: {
            id: true,
            finalAmount: true,
            status: true,
          },
        },
        externalPayment: {
          select: {
            id: true,
            status: true,
            provider: true,
            providerSessionId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const mapped = transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      amountText: formatCurrencyVnd(transaction.amount),
      balanceAfter: transaction.balanceAfter,
      balanceAfterText: formatCurrencyVnd(transaction.balanceAfter),
      note: transaction.note,
      createdAt: transaction.createdAt,
      course: transaction.course,
      purchase: transaction.purchase,
      externalPayment: transaction.externalPayment,
    }));

    res.status(200).json(mapped);
  } catch (error) {
    console.error('Fetch wallet history error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.get('/certificates', verifyToken, async (req, res) => {
  try {
    const certificates = await prisma.certificate.findMany({
      where: { userId: req.userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    res.status(200).json(certificates);
  } catch (error) {
    console.error('Fetch certificates error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.patch('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const notification = await prisma.notification.updateMany({
      where: {
        id: req.params.id,
        userId: req.userId,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    if (notification.count === 0) {
      return res.status(404).json({ message: 'Khong tim thay thong bao' });
    }

    res.status(200).json({ message: 'Da danh dau da doc' });
  } catch (error) {
    console.error('Update notification error:', error);
    res.status(500).json({ message: 'Loi server' });
  }
});

router.post('/avatar', verifyToken, (req, res) => {
  if (!isCloudinaryConfigured()) {
    return res.status(200).json({ avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mock' });
  }

  const uploadSingle = uploadAvatar.single('avatar');

  uploadSingle(req, res, async function uploadAvatarCallback(err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Kich thuoc file qua lon. Toi da 2MB.' });
      }
      return res.status(400).json({ message: 'Loi upload file.', error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Khong tim thay file.' });
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: req.userId },
        data: { avatar: req.file.path },
      });

      res.status(200).json({
        message: 'Tai anh thanh cong',
        avatarUrl: updatedUser.avatar,
      });
    } catch (error) {
      console.error('Update avatar error:', error);
      res.status(500).json({ message: 'Loi server khi cap nhat anh dai dien' });
    }
  });
});

router.delete('/avatar', verifyToken, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { avatar: null },
    });

    res.status(200).json({
      message: 'Da xoa anh dai dien',
      avatarUrl: null,
    });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ message: 'Loi server khi xoa anh dai dien' });
  }
});

router.delete('/me', verifyToken, async (req, res) => {
  try {
    await prisma.user.delete({
      where: { id: req.userId },
    });

    res.status(200).json({ message: 'Tai khoan da duoc xoa vinh vien.' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Loi server khi xoa tai khoan' });
  }
});

export default router;
