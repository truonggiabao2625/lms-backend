import express from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, isAdmin, Role } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(verifyToken, isAdmin);

const clampPage = (value) => Math.max(1, Number.parseInt(value, 10) || 1);
const clampPageSize = (value) => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 20));

const paginated = (items, total, page, pageSize) => ({
  items,
  total,
  page,
  pageSize,
  pages: Math.ceil(total / pageSize),
});

const getPageParams = (query) => {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
};

const getActor = async (actorId) => {
  if (!actorId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, email: true },
  });
};

const writeAuditLog = async (req, { action, entityType, entityId = null, metadata = null }) => {
  try {
    const actor = await getActor(req.userId);
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id || req.userId || null,
        actorEmail: actor?.email || null,
        action,
        entityType,
        entityId,
        metadata,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || null,
      },
    });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
};

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatar: true,
  phone: true,
  walletBalance: true,
  totalSpent: true,
  memberTier: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      courses: true,
      enrollments: true,
      purchases: true,
    },
  },
};

router.get('/users', async (req, res) => {
  try {
    const { q, role } = req.query;
    const { page, pageSize, skip } = getPageParams(req.query);
    const where = {
      ...(role && Object.values(Role).includes(role) ? { role } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json(paginated(items, total, page, pageSize));
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ message: 'Loi server khi lay danh sach nguoi dung' });
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!Object.values(Role).includes(role)) {
      return res.status(400).json({ message: 'Vai tro khong hop le' });
    }

    if (req.params.id === req.userId && role !== Role.ADMIN) {
      return res.status(400).json({ message: 'Khong the tu ha quyen admin cua chinh minh' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, email: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Khong tim thay nguoi dung' });
    }

    if (existing.role === Role.ADMIN && role !== Role.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'He thong phai con it nhat mot admin' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: userSelect,
    });

    await writeAuditLog(req, {
      action: 'USER_ROLE_UPDATED',
      entityType: 'User',
      entityId: updated.id,
      metadata: { previousRole: existing.role, nextRole: role, email: existing.email },
    });

    res.json(updated);
  } catch (error) {
    console.error('Admin update user role error:', error);
    res.status(500).json({ message: 'Loi server khi cap nhat vai tro' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(400).json({ message: 'Khong the xoa tai khoan admin dang dang nhap' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, email: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Khong tim thay nguoi dung' });
    }

    if (existing.role === Role.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'He thong phai con it nhat mot admin' });
      }
    }

    await prisma.user.delete({ where: { id: req.params.id } });

    await writeAuditLog(req, {
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: existing.id,
      metadata: { email: existing.email, role: existing.role },
    });

    res.json({ message: 'Da xoa nguoi dung' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ message: 'Loi server khi xoa nguoi dung' });
  }
});

router.get('/courses', async (req, res) => {
  try {
    const { q, status } = req.query;
    const { page, pageSize, skip } = getPageParams(req.query);
    const where = {
      ...(status === 'published' ? { isPublished: true } : {}),
      ...(status === 'draft' ? { isPublished: false } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { instructor: { name: { contains: q, mode: 'insensitive' } } },
              { instructor: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          instructor: { select: { id: true, name: true, email: true } },
          _count: { select: { lessons: true, enrollments: true, reviews: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.course.count({ where }),
    ]);

    res.json(paginated(items, total, page, pageSize));
  } catch (error) {
    console.error('Admin list courses error:', error);
    res.status(500).json({ message: 'Loi server khi lay danh sach khoa hoc' });
  }
});

router.patch('/courses/:id/publication', async (req, res) => {
  try {
    const isPublished = Boolean(req.body.isPublished);
    const existing = await prisma.course.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, isPublished: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    const updated = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        isPublished,
        publishedAt: isPublished ? new Date() : null,
      },
      include: {
        instructor: { select: { id: true, name: true, email: true } },
        _count: { select: { lessons: true, enrollments: true, reviews: true } },
      },
    });

    await writeAuditLog(req, {
      action: isPublished ? 'COURSE_PUBLISHED_BY_ADMIN' : 'COURSE_UNPUBLISHED_BY_ADMIN',
      entityType: 'Course',
      entityId: updated.id,
      metadata: { title: existing.title, previousPublished: existing.isPublished, nextPublished: isPublished },
    });

    res.json(updated);
  } catch (error) {
    console.error('Admin update course publication error:', error);
    res.status(500).json({ message: 'Loi server khi cap nhat trang thai khoa hoc' });
  }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    const existing = await prisma.course.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, instructorId: true, isPublished: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    await prisma.course.delete({ where: { id: req.params.id } });

    await writeAuditLog(req, {
      action: 'COURSE_DELETED_BY_ADMIN',
      entityType: 'Course',
      entityId: existing.id,
      metadata: existing,
    });

    res.json({ message: 'Da xoa khoa hoc' });
  } catch (error) {
    console.error('Admin delete course error:', error);
    res.status(500).json({ message: 'Loi server khi xoa khoa hoc' });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const { type } = req.query;
    const { page, pageSize, skip } = getPageParams(req.query);
    const where = type ? { type } : {};

    const [items, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
          course: { select: { id: true, title: true } },
          purchase: { select: { id: true, finalAmount: true, status: true } },
          externalPayment: { select: { id: true, provider: true, status: true, amount: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.walletTransaction.count({ where }),
    ]);

    res.json(paginated(items, total, page, pageSize));
  } catch (error) {
    console.error('Admin list transactions error:', error);
    res.status(500).json({ message: 'Loi server khi lay giao dich' });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const { action, entityType } = req.query;
    const { page, pageSize, skip } = getPageParams(req.query);
    const where = {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(paginated(items, total, page, pageSize));
  } catch (error) {
    console.error('Admin list audit logs error:', error);
    res.status(500).json({ message: 'Loi server khi lay audit log' });
  }
});

export default router;
