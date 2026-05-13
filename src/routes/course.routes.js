import express from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { upsertLessonProgress } from '../lib/progress.js';
import { hasRequiredTier } from '../lib/membership.js';

const router = express.Router();

const syncCourseReviewStats = async (tx, courseId) => {
  const stats = await tx.courseReview.aggregate({
    where: { courseId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return tx.course.update({
    where: { id: courseId },
    data: {
      averageRating: stats._avg.rating ?? 0,
      reviewCount: stats._count.rating ?? 0,
    },
  });
};

router.get('/', async (req, res) => {
  try {
    const courses = await prisma.course.findMany({
      where: { isPublished: true },
      include: {
        instructor: {
          select: {
            name: true,
            id: true,
          },
        },
        sections: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              where: { isPublished: true },
              orderBy: { position: 'asc' },
              select: { id: true },
            },
          },
        },
        _count: {
          select: { lessons: true, enrollments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(courses);
  } catch (error) {
    console.error('Fetch courses error:', error);
    res.status(500).json({ message: 'Loi server khi lay danh sach khoa hoc' });
  }
});

router.get('/enrolled', verifyToken, async (req, res) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.userId },
      include: {
        course: {
          include: {
            instructor: { select: { name: true } },
            _count: { select: { lessons: true, enrollments: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.status(200).json(enrollments);
  } catch (error) {
    console.error('Fetch enrolled courses error:', error);
    res.status(500).json({ message: 'Loi server khi lay danh sach khoa hoc da dang ky' });
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        instructor: {
          select: { name: true, email: true },
        },
        sections: {
          orderBy: { position: 'asc' },
          include: {
            lessons: {
              orderBy: { position: 'asc' },
            },
          },
        },
        _count: {
          select: { lessons: true, enrollments: true },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    if (!course.isPublished && course.instructorId !== userId) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId: id,
        },
      },
    });

    let completedLessons = [];
    let certificate = null;
    let userReview = null;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, memberTier: true },
    });

    if (enrollment) {
      const progresses = await prisma.lessonProgress.findMany({
        where: { userId, isCompleted: true, lesson: { courseId: id } },
        select: { lessonId: true },
      });
      completedLessons = progresses.map((progress) => progress.lessonId);

      certificate = await prisma.certificate.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId: id,
          },
        },
      });

      userReview = await prisma.courseReview.findUnique({
        where: {
          userId_courseId: {
            userId,
            courseId: id,
          },
        },
      });
    }

    const isOwner = course.instructorId === userId;
    const canAccessFullCourse = !!enrollment || isOwner;
    const visibleSections = course.sections.map((section) => ({
      ...section,
      lessons: section.lessons.filter((lesson) => {
        if (isOwner) {
          return true;
        }

        if (enrollment) {
          return lesson.isPublished;
        }

        return lesson.isPublished && lesson.isPreview;
      }),
    }));
    const visibleLessons = visibleSections.flatMap((section) =>
      section.lessons.map((lesson) => ({
        ...lesson,
        sectionId: section.id,
        sectionTitle: section.title,
      }))
    );

    res.status(200).json({
      ...course,
      sections: visibleSections,
      lessons: visibleLessons,
      isEnrolled: !!enrollment,
      progress: enrollment ? enrollment.progress : 0,
      completedLessons,
      certificate,
      userReview,
      canPreview: visibleSections.some((section) => section.lessons.length > 0),
      canReview: !!enrollment && !isOwner,
      canPurchase: user ? hasRequiredTier(user.memberTier, course.minimumMemberTier) : false,
    });
  } catch (error) {
    console.error('Fetch course details error:', error);
    res.status(500).json({ message: 'Loi server khi lay chi tiet khoa hoc' });
  }
});

router.get('/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, isPublished: true, averageRating: true, reviewCount: true },
    });

    if (!course || !course.isPublished) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    const reviews = await prisma.courseReview.findMany({
      where: { courseId: id },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    res.status(200).json({
      averageRating: course.averageRating,
      reviewCount: course.reviewCount,
      reviews,
    });
  } catch (error) {
    console.error('Fetch course reviews error:', error);
    res.status(500).json({ message: 'Loi server khi lay danh gia khoa hoc' });
  }
});

router.post('/:id/reviews', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { rating, comment } = req.body;

    const normalizedRating = Number(rating);
    if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
      return res.status(400).json({ message: 'So sao danh gia phai trong khoang tu 1 den 5' });
    }

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, instructorId: true, isPublished: true },
    });

    if (!course || !course.isPublished) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    if (course.instructorId === userId) {
      return res.status(403).json({ message: 'Giang vien khong the tu danh gia khoa hoc cua minh' });
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId: id,
        },
      },
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Ban can dang ky khoa hoc truoc khi danh gia' });
    }

    const review = await prisma.$transaction(async (tx) => {
      const nextReview = await tx.courseReview.upsert({
        where: {
          userId_courseId: {
            userId,
            courseId: id,
          },
        },
        update: {
          rating: normalizedRating,
          comment: comment?.trim() || null,
        },
        create: {
          rating: normalizedRating,
          comment: comment?.trim() || null,
          userId,
          courseId: id,
        },
        include: {
          user: {
            select: { id: true, name: true },
          },
        },
      });

      await syncCourseReviewStats(tx, id);
      return nextReview;
    });

    const updatedCourse = await prisma.course.findUnique({
      where: { id },
      select: { averageRating: true, reviewCount: true },
    });

    res.status(200).json({
      message: 'Da luu danh gia khoa hoc',
      review,
      averageRating: updatedCourse?.averageRating ?? normalizedRating,
      reviewCount: updatedCourse?.reviewCount ?? 1,
    });
  } catch (error) {
    console.error('Create course review error:', error);
    res.status(500).json({ message: 'Loi server khi luu danh gia khoa hoc' });
  }
});

router.delete('/:id/reviews/me', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const existingReview = await prisma.courseReview.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId: id,
        },
      },
    });

    if (!existingReview) {
      return res.status(404).json({ message: 'Ban chua co danh gia nao de xoa' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.courseReview.delete({
        where: {
          userId_courseId: {
            userId,
            courseId: id,
          },
        },
      });
      await syncCourseReviewStats(tx, id);
    });

    const updatedCourse = await prisma.course.findUnique({
      where: { id },
      select: { averageRating: true, reviewCount: true },
    });

    res.status(200).json({
      message: 'Da xoa danh gia cua ban',
      averageRating: updatedCourse?.averageRating ?? 0,
      reviewCount: updatedCourse?.reviewCount ?? 0,
    });
  } catch (error) {
    console.error('Delete course review error:', error);
    res.status(500).json({ message: 'Loi server khi xoa danh gia khoa hoc' });
  }
});

router.post('/:id/enroll', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const course = await prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    if (!course.isPublished) {
      return res.status(400).json({ message: 'Khoa hoc nay dang o che do ban nhap' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { memberTier: true },
    });

    if (user && !hasRequiredTier(user.memberTier, course.minimumMemberTier)) {
      return res.status(403).json({
        message: 'Danh hieu hoi vien hien tai chua du de dang ky khoa hoc nay',
        requiredTier: course.minimumMemberTier,
      });
    }

    if (course.price > 0) {
      return res.status(400).json({
        message: 'Khoa hoc tra phi can duoc thanh toan bang vi noi bo truoc khi dang ky',
      });
    }

    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: {
          userId,
          courseId: id,
        },
      },
    });

    if (existingEnrollment) {
      return res.status(400).json({ message: 'Ban da dang ky khoa hoc nay roi' });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        userId,
        courseId: id,
        progress: 0,
      },
    });

    res.status(201).json({ message: 'Dang ky thanh cong', enrollment });
  } catch (error) {
    console.error('Enroll course error:', error);
    res.status(500).json({ message: 'Loi server khi dang ky khoa hoc' });
  }
});

router.post('/:courseId/lessons/:lessonId/complete', verifyToken, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const userId = req.userId;

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Ban chua dang ky khoa hoc nay' });
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { durationSeconds: true },
    });

    const result = await upsertLessonProgress({
      userId,
      courseId,
      lessonId,
      watchedSeconds: lesson?.durationSeconds || 0,
      lastPositionSeconds: lesson?.durationSeconds || 0,
      durationSeconds: lesson?.durationSeconds || 0,
      markCompleted: true,
    });

    res.status(200).json({
      message: 'Da luu tien do',
      progress: result.progress,
      completedCount: result.completedCount,
      totalLessons: result.totalLessons,
      certificate: result.certificate,
    });
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({ message: 'Loi server khi luu tien do' });
  }
});

router.post('/:courseId/lessons/:lessonId/progress', verifyToken, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const userId = req.userId;
    const { watchedSeconds, lastPositionSeconds, durationSeconds, markCompleted } = req.body;

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Ban chua dang ky khoa hoc nay' });
    }

    const result = await upsertLessonProgress({
      userId,
      courseId,
      lessonId,
      watchedSeconds,
      lastPositionSeconds,
      durationSeconds,
      markCompleted: Boolean(markCompleted),
    });

    res.status(200).json({
      message: 'Da cap nhat tien do bai hoc',
      progress: result.progress,
      completedCount: result.completedCount,
      totalLessons: result.totalLessons,
      lessonProgress: result.lessonProgress,
      certificate: result.certificate,
    });
  } catch (error) {
    if (error.message === 'LESSON_NOT_FOUND') {
      return res.status(404).json({ message: 'Khong tim thay bai hoc' });
    }
    console.error('Update lesson progress error:', error);
    res.status(500).json({ message: 'Loi server khi cap nhat tien do bai hoc' });
  }
});

router.get('/:courseId/lessons/:lessonId/comments', verifyToken, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId: req.userId, courseId } },
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Ban khong co quyen truy cap bai hoc nay' });
    }

    const comments = await prisma.comment.findMany({
      where: { lessonId, parentId: null },
      include: {
        user: { select: { name: true, id: true, role: true } },
        replies: {
          include: {
            user: { select: { name: true, id: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(comments);
  } catch (error) {
    console.error('Fetch comments error:', error);
    res.status(500).json({ message: 'Loi server khi lay binh luan' });
  }
});

router.post('/:courseId/lessons/:lessonId/comments', verifyToken, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const { content, parentId } = req.body;
    const userId = req.userId;

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (!enrollment) {
      return res.status(403).json({ message: 'Ban khong co quyen truy cap bai hoc nay' });
    }

    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Noi dung binh luan khong duoc de trong' });
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        lessonId,
        userId,
        parentId: parentId || null,
      },
      include: {
        user: { select: { name: true, id: true, role: true } },
        replies: true,
      },
    });

    res.status(201).json(comment);
  } catch (error) {
    console.error('Post comment error:', error);
    res.status(500).json({ message: 'Loi server khi gui binh luan' });
  }
});

export default router;
