import express from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, Role } from '../middleware/auth.middleware.js';
import { formatCurrencyVnd } from '../lib/membership.js';

const router = express.Router();

/**
 * GET /api/dashboard/stats
 *
 * Returns role-tailored dashboard statistics.
 * – STUDENT  → enrollment count, completed count, certificates, wallet, progress
 * – INSTRUCTOR → course count, total students, revenue, recent enrollments
 * – ADMIN    → platform-wide user/course/revenue totals, pending webhooks
 */
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const role = req.userRole;

    if (role === Role.STUDENT) {
      const [enrollments, completedLessons, certificates, user] = await Promise.all([
        prisma.enrollment.findMany({
          where: { userId },
          include: {
            course: {
              select: {
                id: true,
                title: true,
                slug: true,
                thumbnail: true,
                totalDurationSeconds: true,
                _count: { select: { lessons: true } },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        }),
        prisma.lessonProgress.count({
          where: { userId, isCompleted: true },
        }),
        prisma.certificate.count({
          where: { userId },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            walletBalance: true,
            totalSpent: true,
            memberTier: true,
          },
        }),
      ]);

      const totalEnrolled = enrollments.length;
      const completedCourses = enrollments.filter(
        (e) => e.completedAt !== null
      ).length;

      // Calculate average progress across all enrollments
      const avgProgress =
        totalEnrolled > 0
          ? Math.round(
              enrollments.reduce((sum, e) => sum + (e.progress || 0), 0) /
                totalEnrolled
            )
          : 0;

      // Find the most recently active enrollments for "Continue Watching"
      const recentCourses = enrollments
        .filter((e) => e.completedAt === null)
        .slice(0, 3)
        .map((e) => ({
          courseId: e.course.id,
          title: e.course.title,
          slug: e.course.slug,
          thumbnail: e.course.thumbnail,
          progress: Math.round(e.progress || 0),
          totalLessons: e.course._count.lessons,
          totalDuration: e.course.totalDurationSeconds,
        }));

      return res.json({
        role: Role.STUDENT,
        stats: {
          totalEnrolled,
          completedCourses,
          completedLessons,
          certificates,
          avgProgress,
          walletBalance: user?.walletBalance ?? 0,
          totalSpent: user?.totalSpent ?? 0,
          memberTier: user?.memberTier ?? 'BRONZE',
        },
        recentCourses,
      });
    }

    if (role === Role.INSTRUCTOR) {
      const [courses, enrollments, purchases, recentEnrollments] =
        await Promise.all([
          prisma.course.findMany({
            where: { instructorId: userId },
            select: {
              id: true,
              title: true,
              isPublished: true,
              _count: { select: { enrollments: true, lessons: true } },
            },
          }),
          prisma.enrollment.findMany({
            where: { course: { instructorId: userId } },
            select: { userId: true },
          }),
          prisma.purchase.findMany({
            where: {
              status: 'COMPLETED',
              course: { instructorId: userId },
            },
            select: { finalAmount: true },
          }),
          prisma.enrollment.findMany({
            where: { course: { instructorId: userId } },
            include: {
              user: { select: { id: true, name: true, email: true, avatar: true } },
              course: { select: { id: true, title: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
        ]);

      const totalRevenue = purchases.reduce(
        (sum, p) => sum + (p.finalAmount || 0),
        0
      );
      const uniqueStudents = new Set(enrollments.map((e) => e.userId)).size;

      return res.json({
        role: Role.INSTRUCTOR,
        stats: {
          totalCourses: courses.length,
          publishedCourses: courses.filter((c) => c.isPublished).length,
          draftCourses: courses.filter((c) => !c.isPublished).length,
          totalStudents: uniqueStudents,
          totalRevenue,
          totalRevenueFormatted: formatCurrencyVnd(totalRevenue),
        },
        courses: courses.map((c) => ({
          id: c.id,
          title: c.title,
          isPublished: c.isPublished,
          enrollments: c._count.enrollments,
          lessons: c._count.lessons,
        })),
        recentEnrollments: recentEnrollments.map((e) => ({
          studentName: e.user.name,
          studentEmail: e.user.email,
          studentAvatar: e.user.avatar,
          courseTitle: e.course.title,
          enrolledAt: e.createdAt,
        })),
      });
    }

    if (role === Role.ADMIN) {
      const [
        totalUsers,
        totalCourses,
        totalEnrollments,
        totalRevenue,
        pendingPayments,
        recentUsers,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.course.count(),
        prisma.enrollment.count(),
        prisma.purchase.aggregate({
          _sum: { finalAmount: true },
          where: { status: 'COMPLETED' },
        }),
        prisma.externalPayment.count({ where: { status: 'PENDING' } }),
        prisma.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

      const revenue = totalRevenue._sum.finalAmount || 0;

      return res.json({
        role: Role.ADMIN,
        stats: {
          totalUsers,
          totalCourses,
          totalEnrollments,
          totalRevenue: revenue,
          totalRevenueFormatted: formatCurrencyVnd(revenue),
          pendingPayments,
        },
        recentUsers,
      });
    }

    // Fallback for unknown roles
    return res.status(403).json({ message: 'Vai tro khong duoc ho tro' });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Loi server khi lay du lieu dashboard' });
  }
});

export default router;
