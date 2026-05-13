import crypto from 'crypto';
import prisma from './prisma.js';

const CERTIFICATE_COMPLETION_THRESHOLD = 100;
const LESSON_COMPLETION_THRESHOLD = 0.9;

const buildCertificateNumber = () => `CERT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const buildVerifyCode = () => crypto.randomBytes(8).toString('hex');

const issueCertificateIfEligible = async (tx, { userId, courseId, completedLessons, totalLessons }) => {
  if (!totalLessons || completedLessons < totalLessons) {
    return { certificate: null, created: false };
  }

  const existingCertificate = await tx.certificate.findUnique({
    where: {
      userId_courseId: {
        userId,
        courseId,
      },
    },
  });

  if (existingCertificate) {
    return { certificate: existingCertificate, created: false };
  }

  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true },
  });

  const certificate = await tx.certificate.create({
    data: {
      userId,
      courseId,
      certificateNo: buildCertificateNumber(),
      verifyCode: buildVerifyCode(),
      completionSnapshot: {
        totalLessons,
        completedLessons,
        courseTitle: course?.title || '',
      },
    },
  });

  return { certificate, created: true };
};

const createCompletionNotification = async (tx, { userId, courseId }) => {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { title: true },
  });

  if (!course) {
    return;
  }

  await tx.notification.create({
    data: {
      userId,
      type: 'COURSE_COMPLETED',
      title: 'Ban da hoan thanh khoa hoc',
      body: `Chuc mung! Ban da hoan thanh khoa hoc ${course.title}.`,
      link: `/course/${courseId}`,
      metadata: { courseId },
    },
  });
};

const createCertificateNotification = async (tx, { userId, courseId, certificateId }) => {
  await tx.notification.create({
    data: {
      userId,
      type: 'CERTIFICATE_ISSUED',
      title: 'Chung chi da san sang',
      body: 'Ban da du dieu kien nhan chung chi cho khoa hoc vua hoan thanh.',
      link: `/course/${courseId}?certificate=${certificateId}`,
      metadata: { courseId, certificateId },
    },
  });
};

export const syncEnrollmentProgress = async ({ userId, courseId }) => {
  return prisma.$transaction(async (tx) => syncEnrollmentProgressInTransaction(tx, { userId, courseId }));
};

export const syncEnrollmentProgressInTransaction = async (tx, { userId, courseId }) => {
  const totalLessons = await tx.lesson.count({
    where: {
      courseId,
      isPublished: true,
    },
  });

  const completedCount = await tx.lessonProgress.count({
    where: {
      userId,
      isCompleted: true,
      lesson: {
        courseId,
        isPublished: true,
      },
    },
  });

  const progress = totalLessons > 0 ? Math.round((completedCount / totalLessons) * CERTIFICATE_COMPLETION_THRESHOLD) : 0;

  const enrollment = await tx.enrollment.update({
    where: { userId_courseId: { userId, courseId } },
    data: {
      progress,
      completedAt: progress === CERTIFICATE_COMPLETION_THRESHOLD ? new Date() : null,
    },
  });

  let certificate = null;
  if (progress === CERTIFICATE_COMPLETION_THRESHOLD) {
    const certificateResult = await issueCertificateIfEligible(tx, {
      userId,
      courseId,
      completedLessons: completedCount,
      totalLessons,
    });
    certificate = certificateResult.certificate;

    if (certificateResult.created && certificate) {
      await createCompletionNotification(tx, { userId, courseId });
      await createCertificateNotification(tx, { userId, courseId, certificateId: certificate.id });
    }
  }

  return {
    enrollment,
    progress,
    completedCount,
    totalLessons,
    certificate,
  };
};

export const upsertLessonProgress = async ({
  userId,
  courseId,
  lessonId,
  watchedSeconds = 0,
  lastPositionSeconds = 0,
  durationSeconds = 0,
  markCompleted = false,
}) => {
  return prisma.$transaction(async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        courseId: true,
        durationSeconds: true,
      },
    });

    if (!lesson || lesson.courseId !== courseId) {
      throw new Error('LESSON_NOT_FOUND');
    }

    const existingProgress = await tx.lessonProgress.findUnique({
      where: {
        userId_lessonId: {
          userId,
          lessonId,
        },
      },
      select: {
        watchedSeconds: true,
        lastPositionSeconds: true,
        completionRate: true,
        isCompleted: true,
      },
    });

    const effectiveDuration = Math.max(lesson.durationSeconds || 0, Number(durationSeconds) || 0);
    const normalizedWatched = Math.max(0, Math.round(Number(watchedSeconds) || 0));
    const normalizedLastPosition = Math.max(0, Math.round(Number(lastPositionSeconds) || 0));
    const previousWatched = existingProgress?.watchedSeconds || 0;
    const previousLastPosition = existingProgress?.lastPositionSeconds || 0;
    const clampedWatched = effectiveDuration > 0 ? Math.min(Math.max(normalizedWatched, previousWatched), effectiveDuration) : Math.max(normalizedWatched, previousWatched);
    const clampedLastPosition =
      effectiveDuration > 0
        ? Math.min(Math.max(normalizedLastPosition, previousLastPosition), effectiveDuration)
        : Math.max(normalizedLastPosition, previousLastPosition);
    const completionRate =
      effectiveDuration > 0
        ? Math.max(existingProgress?.completionRate || 0, Math.min(clampedWatched / effectiveDuration, 1))
        : markCompleted || existingProgress?.isCompleted
          ? 1
          : 0;
    const isCompleted = Boolean(existingProgress?.isCompleted || markCompleted || completionRate >= LESSON_COMPLETION_THRESHOLD);

    const lessonProgress = await tx.lessonProgress.upsert({
      where: {
        userId_lessonId: {
          userId,
          lessonId,
        },
      },
      update: {
        watchedSeconds: clampedWatched,
        lastPositionSeconds: clampedLastPosition,
        completionRate,
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
      create: {
        userId,
        lessonId,
        watchedSeconds: clampedWatched,
        lastPositionSeconds: clampedLastPosition,
        completionRate,
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      },
    });

    const syncResult = await syncEnrollmentProgressInTransaction(tx, { userId, courseId });

    return {
      lessonProgress,
      ...syncResult,
    };
  });
};
