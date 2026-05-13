const VIETNAMESE_MAP = {
  a: /[áàảãạăắằẳẵặâấầẩẫậ]/g,
  e: /[éèẻẽẹêếềểễệ]/g,
  i: /[íìỉĩị]/g,
  o: /[óòỏõọôốồổỗộơớờởỡợ]/g,
  u: /[úùủũụưứừửữự]/g,
  y: /[ýỳỷỹỵ]/g,
  d: /[đ]/g,
};

const normalizeVietnamese = (value = '') => {
  let normalized = value.toLowerCase();
  Object.entries(VIETNAMESE_MAP).forEach(([ascii, pattern]) => {
    normalized = normalized.replace(pattern, ascii);
  });
  return normalized;
};

export const slugify = (value = '') => {
  return normalizeVietnamese(value)
    .replace(/c#/g, 'c-sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
};

export const ensureUniqueSlug = async (prismaClient, title, excludeCourseId = null) => {
  const baseSlug = slugify(title) || 'khoa-hoc';
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const existing = await prismaClient.course.findFirst({
      where: {
        slug,
        ...(excludeCourseId ? { id: { not: excludeCourseId } } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      return slug;
    }

    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
};
