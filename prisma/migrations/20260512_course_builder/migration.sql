CREATE TABLE IF NOT EXISTS "Section" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Course"
ADD COLUMN IF NOT EXISTS "slug" TEXT,
ADD COLUMN IF NOT EXISTS "minimumMemberTier" "MemberTier" NOT NULL DEFAULT 'BRONZE',
ADD COLUMN IF NOT EXISTS "totalDurationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

ALTER TABLE "Lesson"
ADD COLUMN IF NOT EXISTS "durationSeconds" INTEGER,
ADD COLUMN IF NOT EXISTS "isPreview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "sectionId" TEXT;

CREATE INDEX IF NOT EXISTS "Section_courseId_idx" ON "Section"("courseId");
CREATE UNIQUE INDEX IF NOT EXISTS "Section_courseId_position_key" ON "Section"("courseId", "position");
CREATE INDEX IF NOT EXISTS "Course_slug_idx" ON "Course"("slug");
CREATE INDEX IF NOT EXISTS "Lesson_sectionId_idx" ON "Lesson"("sectionId");
CREATE INDEX IF NOT EXISTS "Lesson_courseId_isPreview_idx" ON "Lesson"("courseId", "isPreview");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Section_courseId_fkey'
  ) THEN
    ALTER TABLE "Section"
    ADD CONSTRAINT "Section_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "Section" ("id", "title", "description", "position", "courseId", "createdAt", "updatedAt")
SELECT
  CONCAT('section_', SUBSTRING(md5(random()::text || clock_timestamp()::text || c."id"), 1, 24)),
  'Noi dung chinh',
  NULL,
  1,
  c."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Course" c
WHERE EXISTS (
  SELECT 1 FROM "Lesson" l WHERE l."courseId" = c."id"
)
AND NOT EXISTS (
  SELECT 1 FROM "Section" s WHERE s."courseId" = c."id"
);

UPDATE "Lesson" l
SET "sectionId" = s."id"
FROM "Section" s
WHERE s."courseId" = l."courseId"
  AND s."position" = 1
  AND l."sectionId" IS NULL;

UPDATE "Course"
SET "slug" = CONCAT('course-', "id")
WHERE "slug" IS NULL OR TRIM("slug") = '';

UPDATE "Course" c
SET "totalDurationSeconds" = COALESCE((
  SELECT SUM(COALESCE(l."durationSeconds", 0))::INTEGER
  FROM "Lesson" l
  WHERE l."courseId" = c."id"
), 0);

UPDATE "Course"
SET "publishedAt" = CASE
  WHEN "isPublished" = true AND "publishedAt" IS NULL THEN CURRENT_TIMESTAMP
  WHEN "isPublished" = false THEN NULL
  ELSE "publishedAt"
END;

ALTER TABLE "Course"
ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "Lesson"
ALTER COLUMN "sectionId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Course_slug_key" ON "Course"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Lesson_sectionId_position_key" ON "Lesson"("sectionId", "position");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Lesson_sectionId_fkey'
  ) THEN
    ALTER TABLE "Lesson"
    ADD CONSTRAINT "Lesson_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
