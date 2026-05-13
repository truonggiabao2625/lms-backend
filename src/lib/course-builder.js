export const courseDetailsInclude = {
  sections: {
    orderBy: { position: 'asc' },
    include: {
      lessons: {
        orderBy: { position: 'asc' },
      },
    },
  },
  instructor: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

export const getPublishValidationErrors = (course) => {
  const errors = [];

  if (!course.description || !course.description.trim()) {
    errors.push('Khoa hoc can co mo ta truoc khi xuat ban');
  }

  if (!course.thumbnail || !course.thumbnail.trim()) {
    errors.push('Khoa hoc can co anh bia truoc khi xuat ban');
  }

  const publishedLessonCount =
    course.sections?.reduce(
      (sum, section) => sum + (section.lessons?.filter((lesson) => lesson.isPublished).length || 0),
      0
    ) || 0;

  if (publishedLessonCount < 1) {
    errors.push('Khoa hoc phai co it nhat 1 bai giang da xuat ban truoc khi xuat ban khoa hoc');
  }

  return errors;
};

export const sumCourseDuration = (sections = []) => {
  return sections.reduce(
    (courseSum, section) =>
      courseSum +
      (section.lessons || []).reduce((lessonSum, lesson) => lessonSum + (lesson.durationSeconds || 0), 0),
    0
  );
};

export const formatCurriculumResponse = (course) => {
  const totalLessons = course.sections?.reduce((sum, section) => sum + (section.lessons?.length || 0), 0) || 0;
  const publishValidationErrors = getPublishValidationErrors(course);

  return {
    ...course,
    totalLessons,
    totalDurationSeconds: course.totalDurationSeconds ?? sumCourseDuration(course.sections),
    publishValidationErrors,
    canPublish: publishValidationErrors.length === 0,
  };
};

export const recalculateCourseDuration = async (prismaClient, courseId) => {
  const aggregate = await prismaClient.lesson.aggregate({
    where: { courseId },
    _sum: { durationSeconds: true },
  });

  const totalDurationSeconds = aggregate._sum.durationSeconds || 0;

  await prismaClient.course.update({
    where: { id: courseId },
    data: { totalDurationSeconds },
  });

  return totalDurationSeconds;
};
