import express from 'express';
import prisma from '../lib/prisma.js';
import { verifyToken, isInstructor } from '../middleware/auth.middleware.js';
import { uploadVideo, isCloudinaryConfigured, cloudinary } from '../lib/cloudinary.js';
import { ensureUniqueSlug } from '../lib/slug.js';
import {
  courseDetailsInclude,
  formatCurriculumResponse,
  getPublishValidationErrors,
  recalculateCourseDuration,
} from '../lib/course-builder.js';

const router = express.Router();

const roundPrice = (price) => Math.max(0, Math.round(Number(price) || 0));
const roundDuration = (duration) => (duration === undefined || duration === null ? null : Math.max(0, Math.round(Number(duration) || 0)));

const applyOrderedPositions = async (tx, modelName, items) => {
  for (let index = 0; index < items.length; index += 1) {
    await tx[modelName].update({
      where: { id: items[index].id },
      data: { position: 1000 + index },
    });
  }

  for (let index = 0; index < items.length; index += 1) {
    await tx[modelName].update({
      where: { id: items[index].id },
      data: {
        position: index + 1,
        ...(items[index].sectionId ? { sectionId: items[index].sectionId } : {}),
        ...(items[index].courseId ? { courseId: items[index].courseId } : {}),
      },
    });
  }
};

const getOwnedCourseOrThrow = async (courseId, instructorId) => {
  return prisma.course.findFirst({
    where: { id: courseId, instructorId },
    include: courseDetailsInclude,
  });
};

const getVideoDurationSeconds = async (file) => {
  if (!file) {
    return null;
  }

  if (file.duration) {
    return Math.round(Number(file.duration));
  }

  if (!isCloudinaryConfigured()) {
    return null;
  }

  const publicId = file.filename || file.public_id;
  if (!publicId) {
    return null;
  }

  try {
    const resource = await cloudinary.api.resource(publicId, { resource_type: 'video' });
    return resource?.duration ? Math.round(Number(resource.duration)) : null;
  } catch (error) {
    console.warn('Unable to resolve Cloudinary video duration:', error.message);
    return null;
  }
};

router.get('/dashboard', verifyToken, isInstructor, async (req, res) => {
  try {
    const instructorId = req.userId;

    const [courses, enrollments, purchases] = await Promise.all([
      prisma.course.findMany({
        where: { instructorId },
        include: {
          _count: {
            select: { enrollments: true, lessons: true, sections: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.enrollment.findMany({
        where: { course: { instructorId } },
        select: { userId: true },
      }),
      prisma.purchase.findMany({
        where: {
          status: 'COMPLETED',
          course: { instructorId },
        },
        select: {
          finalAmount: true,
        },
      }),
    ]);

    res.status(200).json({
      totalCourses: courses.length,
      totalStudents: new Set(enrollments.map((enrollment) => enrollment.userId)).size,
      totalRevenue: purchases.reduce((sum, purchase) => sum + (purchase.finalAmount || 0), 0),
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        price: course.price,
        thumbnail: course.thumbnail,
        minimumMemberTier: course.minimumMemberTier,
        totalDurationSeconds: course.totalDurationSeconds,
        isPublished: course.isPublished,
        enrollments: course._count.enrollments,
        lessons: course._count.lessons,
        sections: course._count.sections,
      })),
    });
  } catch (error) {
    console.error('Instructor dashboard error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.get('/revenue', verifyToken, isInstructor, async (req, res) => {
  try {
    const instructorId = req.userId;

    const [courses, purchases, recentPurchases] = await Promise.all([
      prisma.course.findMany({
        where: { instructorId },
        include: {
          _count: {
            select: { enrollments: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.purchase.findMany({
        where: {
          status: 'COMPLETED',
          course: { instructorId },
        },
        select: {
          finalAmount: true,
          courseId: true,
          userId: true,
          createdAt: true,
        },
      }),
      prisma.purchase.findMany({
        where: {
          status: 'COMPLETED',
          course: { instructorId },
        },
        include: {
          course: { select: { id: true, title: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const purchasesByCourse = purchases.reduce((acc, purchase) => {
      const current = acc.get(purchase.courseId) || { revenue: 0, purchases: 0 };
      current.revenue += purchase.finalAmount || 0;
      current.purchases += 1;
      acc.set(purchase.courseId, current);
      return acc;
    }, new Map());

    const monthBuckets = new Map();
    purchases.forEach((purchase) => {
      const date = new Date(purchase.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const current = monthBuckets.get(key) || 0;
      monthBuckets.set(key, current + (purchase.finalAmount || 0));
    });

    const totalRevenue = purchases.reduce((sum, purchase) => sum + (purchase.finalAmount || 0), 0);

    res.status(200).json({
      totalRevenue,
      totalPurchases: purchases.length,
      totalStudents: new Set(purchases.map((purchase) => purchase.userId)).size,
      averageOrderValue: purchases.length ? Math.round(totalRevenue / purchases.length) : 0,
      monthlyRevenue: Array.from(monthBuckets.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, revenue]) => ({ month, revenue })),
      courses: courses.map((course) => {
        const courseRevenue = purchasesByCourse.get(course.id) || { revenue: 0, purchases: 0 };
        return {
          id: course.id,
          title: course.title,
          price: course.price,
          isPublished: course.isPublished,
          enrollments: course._count.enrollments,
          revenue: courseRevenue.revenue,
          purchases: courseRevenue.purchases,
        };
      }),
      recentPurchases: recentPurchases.map((purchase) => ({
        id: purchase.id,
        amount: purchase.finalAmount,
        createdAt: purchase.createdAt,
        course: purchase.course,
        user: purchase.user,
      })),
    });
  } catch (error) {
    console.error('Instructor revenue error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.post('/courses', verifyToken, isInstructor, async (req, res) => {
  try {
    const { title, description, price, thumbnail, minimumMemberTier } = req.body;
    const instructorId = req.userId;
    const safeTitle = (title || 'Khoa hoc moi').trim();
    const slug = await ensureUniqueSlug(prisma, safeTitle);

    const newCourse = await prisma.course.create({
      data: {
        title: safeTitle,
        slug,
        description: description || '',
        thumbnail: thumbnail || '',
        price: roundPrice(price),
        minimumMemberTier: minimumMemberTier || 'BRONZE',
        instructorId,
        isPublished: false,
      },
      include: courseDetailsInclude,
    });

    res.status(201).json(formatCurriculumResponse(newCourse));
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.get('/courses/:id', verifyToken, isInstructor, async (req, res) => {
  try {
    const course = await getOwnedCourseOrThrow(req.params.id, req.userId);

    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    res.status(200).json(formatCurriculumResponse(course));
  } catch (error) {
    console.error('Get course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.put('/courses/:id', verifyToken, isInstructor, async (req, res) => {
  try {
    const existing = await getOwnedCourseOrThrow(req.params.id, req.userId);

    if (!existing) {
      return res.status(403).json({ message: 'Khong co quyen chinh sua' });
    }

    const nextTitle = (req.body.title || existing.title).trim();
    const slug = nextTitle !== existing.title ? await ensureUniqueSlug(prisma, nextTitle, existing.id) : existing.slug;

    const updated = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        title: nextTitle,
        slug,
        description: req.body.description ?? existing.description,
        thumbnail: req.body.thumbnail ?? existing.thumbnail,
        price: req.body.price === undefined ? existing.price : roundPrice(req.body.price),
        minimumMemberTier: req.body.minimumMemberTier || existing.minimumMemberTier,
      },
      include: courseDetailsInclude,
    });

    res.status(200).json(formatCurriculumResponse(updated));
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.post('/courses/:id/publish', verifyToken, isInstructor, async (req, res) => {
  try {
    const course = await getOwnedCourseOrThrow(req.params.id, req.userId);
    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    const errors = getPublishValidationErrors(course);
    if (errors.length > 0) {
      return res.status(400).json({
        message: 'Khoa hoc chua du dieu kien xuat ban',
        errors,
      });
    }

    const updated = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
      include: courseDetailsInclude,
    });

    res.status(200).json(formatCurriculumResponse(updated));
  } catch (error) {
    console.error('Publish course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.post('/courses/:id/unpublish', verifyToken, isInstructor, async (req, res) => {
  try {
    const course = await getOwnedCourseOrThrow(req.params.id, req.userId);
    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    const updated = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        isPublished: false,
        publishedAt: null,
      },
      include: courseDetailsInclude,
    });

    res.status(200).json(formatCurriculumResponse(updated));
  } catch (error) {
    console.error('Unpublish course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.delete('/courses/:id', verifyToken, isInstructor, async (req, res) => {
  try {
    const existing = await prisma.course.findFirst({
      where: { id: req.params.id, instructorId: req.userId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(403).json({ message: 'Khong co quyen xoa khoa hoc nay' });
    }

    await prisma.course.delete({ where: { id: req.params.id } });

    res.status(200).json({ message: 'Da xoa khoa hoc thanh cong' });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.get('/courses/:courseId/curriculum', verifyToken, isInstructor, async (req, res) => {
  try {
    const course = await getOwnedCourseOrThrow(req.params.courseId, req.userId);
    if (!course) {
      return res.status(404).json({ message: 'Khong tim thay khoa hoc' });
    }

    res.status(200).json(formatCurriculumResponse(course));
  } catch (error) {
    console.error('Get curriculum error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.post('/courses/:courseId/sections', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await prisma.course.findFirst({ where: { id: courseId, instructorId: req.userId } });
    if (!course) {
      return res.status(403).json({ message: 'Khong co quyen truy cap' });
    }

    const lastSection = await prisma.section.findFirst({
      where: { courseId },
      orderBy: { position: 'desc' },
    });

    const section = await prisma.section.create({
      data: {
        courseId,
        title: req.body.title?.trim() || 'Chuong moi',
        description: req.body.description || '',
        position: lastSection ? lastSection.position + 1 : 1,
      },
      include: {
        lessons: {
          orderBy: { position: 'asc' },
        },
      },
    });

    res.status(201).json(section);
  } catch (error) {
    console.error('Create section error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.put('/courses/:courseId/sections/:sectionId', verifyToken, isInstructor, async (req, res) => {
  try {
    const section = await prisma.section.findFirst({
      where: {
        id: req.params.sectionId,
        courseId: req.params.courseId,
        course: { instructorId: req.userId },
      },
    });

    if (!section) {
      return res.status(404).json({ message: 'Khong tim thay chuong' });
    }

    const updated = await prisma.section.update({
      where: { id: req.params.sectionId },
      data: {
        title: req.body.title ?? section.title,
        description: req.body.description ?? section.description,
      },
      include: {
        lessons: {
          orderBy: { position: 'asc' },
        },
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    console.error('Update section error:', error);
    res.status(500).json({ message: 'Loi cap nhat chuong' });
  }
});

router.delete('/courses/:courseId/sections/:sectionId', verifyToken, isInstructor, async (req, res) => {
  try {
    const section = await prisma.section.findFirst({
      where: {
        id: req.params.sectionId,
        courseId: req.params.courseId,
        course: { instructorId: req.userId },
      },
    });

    if (!section) {
      return res.status(404).json({ message: 'Khong tim thay chuong' });
    }

    await prisma.section.delete({ where: { id: req.params.sectionId } });

    const remainingSections = await prisma.section.findMany({
      where: { courseId: req.params.courseId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await applyOrderedPositions(tx, 'section', remainingSections);
    });

    await recalculateCourseDuration(prisma, req.params.courseId);

    res.status(200).json({ message: 'Da xoa chuong' });
  } catch (error) {
    console.error('Delete section error:', error);
    res.status(500).json({ message: 'Loi xoa chuong' });
  }
});

router.post('/courses/:courseId/sections/:sectionId/lessons', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId, sectionId } = req.params;
    const section = await prisma.section.findFirst({
      where: {
        id: sectionId,
        courseId,
        course: { instructorId: req.userId },
      },
    });
    if (!section) {
      return res.status(403).json({ message: 'Khong co quyen truy cap' });
    }

    const lastLesson = await prisma.lesson.findFirst({
      where: { sectionId },
      orderBy: { position: 'desc' },
    });
    const position = lastLesson ? lastLesson.position + 1 : 1;

    const lesson = await prisma.lesson.create({
      data: {
        title: req.body.title?.trim() || 'Bai giang moi',
        videoUrl: req.body.videoUrl || '',
        content: req.body.content || '',
        durationSeconds: roundDuration(req.body.durationSeconds),
        position,
        courseId,
        sectionId,
        isPublished: req.body.isPublished === undefined ? true : Boolean(req.body.isPublished),
        isPreview: Boolean(req.body.isPreview),
      },
    });

    await recalculateCourseDuration(prisma, courseId);

    res.status(201).json(lesson);
  } catch (error) {
    console.error('Create lesson error:', error);
    res.status(500).json({ message: 'Loi may chu' });
  }
});

router.put('/courses/:courseId/lessons/:lessonId', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
        course: { instructorId: req.userId },
      },
    });

    if (!lesson) {
      return res.status(404).json({ message: 'Khong tim thay bai giang' });
    }

    let targetSectionId = req.body.sectionId || lesson.sectionId;

    if (targetSectionId !== lesson.sectionId) {
      const targetSection = await prisma.section.findFirst({
        where: {
          id: targetSectionId,
          courseId,
          course: { instructorId: req.userId },
        },
      });

      if (!targetSection) {
        return res.status(400).json({ message: 'Chuong dich khong hop le' });
      }
    }

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: req.body.title ?? lesson.title,
        videoUrl: req.body.videoUrl ?? lesson.videoUrl,
        content: req.body.content ?? lesson.content,
        durationSeconds: req.body.durationSeconds === undefined ? lesson.durationSeconds : roundDuration(req.body.durationSeconds),
        position: req.body.position ?? lesson.position,
        isPublished: req.body.isPublished === undefined ? lesson.isPublished : Boolean(req.body.isPublished),
        isPreview: req.body.isPreview === undefined ? lesson.isPreview : Boolean(req.body.isPreview),
        sectionId: targetSectionId,
      },
    });

    await recalculateCourseDuration(prisma, courseId);

    res.status(200).json(updated);
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ message: 'Loi cap nhat bai giang' });
  }
});

router.delete('/courses/:courseId/lessons/:lessonId', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;

    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
        course: { instructorId: req.userId },
      },
    });
    if (!lesson) {
      return res.status(403).json({ message: 'Khong co quyen truy cap' });
    }

    await prisma.lesson.delete({ where: { id: lessonId } });

    const remainingLessons = await prisma.lesson.findMany({
      where: { sectionId: lesson.sectionId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await applyOrderedPositions(
        tx,
        'lesson',
        remainingLessons.map((item) => ({
          ...item,
          sectionId: lesson.sectionId,
        }))
      );
    });

    await recalculateCourseDuration(prisma, courseId);

    res.status(200).json({ message: 'Da xoa bai giang' });
  } catch (error) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ message: 'Loi xoa bai giang' });
  }
});

router.put('/courses/:courseId/curriculum/reorder', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { sections } = req.body;

    const course = await prisma.course.findFirst({
      where: { id: courseId, instructorId: req.userId },
      select: { id: true },
    });

    if (!course) {
      return res.status(403).json({ message: 'Khong co quyen truy cap' });
    }

    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ message: 'Du lieu sap xep khong hop le' });
    }

    const existingSections = await prisma.section.findMany({
      where: { courseId },
      include: { lessons: true },
    });

    const sectionIds = new Set(existingSections.map((section) => section.id));
    const lessonIds = new Set(existingSections.flatMap((section) => section.lessons.map((lesson) => lesson.id)));

    sections.forEach((section) => {
      if (!sectionIds.has(section.id)) {
        throw new Error('INVALID_SECTION');
      }

      (section.lessons || []).forEach((lesson) => {
        if (!lessonIds.has(lesson.id)) {
          throw new Error('INVALID_LESSON');
        }
      });
    });

    await prisma.$transaction(async (tx) => {
      await applyOrderedPositions(
        tx,
        'section',
        sections.map((section) => ({ id: section.id }))
      );

      for (const section of sections) {
        await applyOrderedPositions(
          tx,
          'lesson',
          (section.lessons || []).map((lesson) => ({
            id: lesson.id,
            sectionId: section.id,
            courseId,
          }))
        );
      }
    });

    const refreshed = await getOwnedCourseOrThrow(courseId, req.userId);
    res.status(200).json(formatCurriculumResponse(refreshed));
  } catch (error) {
    if (error.message === 'INVALID_SECTION' || error.message === 'INVALID_LESSON') {
      return res.status(400).json({ message: 'Co phan tu khong thuoc khoa hoc nay' });
    }
    console.error('Reorder curriculum error:', error);
    res.status(500).json({ message: 'Loi cap nhat thu tu giao trinh' });
  }
});

router.post('/courses/:courseId/lessons/:lessonId/video', verifyToken, isInstructor, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;

    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        courseId,
        course: { instructorId: req.userId },
      },
      select: { id: true },
    });

    if (!lesson) {
      return res.status(403).json({ message: 'Khong co quyen truy cap bai giang nay' });
    }

    if (!isCloudinaryConfigured()) {
      return res.status(400).json({ message: 'Cloudinary chua duoc cau hinh cho ung dung' });
    }

    const uploadSingle = uploadVideo.single('video');

    uploadSingle(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'Video qua lon. Toi da 100MB.' });
        }
        return res.status(400).json({ message: 'Loi tai video.', error: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Khong tim thay file video' });
      }

      const durationSeconds = await getVideoDurationSeconds(req.file);
      const updatedLesson = await prisma.lesson.update({
        where: { id: lessonId },
        data: {
          videoUrl: req.file.path,
          durationSeconds,
        },
      });

      await recalculateCourseDuration(prisma, courseId);

      return res.status(200).json({
        message: 'Tai video thanh cong',
        videoUrl: updatedLesson.videoUrl,
        durationSeconds: updatedLesson.durationSeconds,
      });
    });
  } catch (error) {
    console.error('Upload lesson video error:', error);
    res.status(500).json({ message: 'Loi server khi upload video' });
  }
});

export default router;
