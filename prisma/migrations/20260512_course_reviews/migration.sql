ALTER TABLE "Course"
ADD COLUMN IF NOT EXISTS "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "CourseReview" (
  "id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseReview_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseReview_userId_courseId_key" ON "CourseReview"("userId", "courseId");
CREATE INDEX IF NOT EXISTS "CourseReview_courseId_createdAt_idx" ON "CourseReview"("courseId", "createdAt");
CREATE INDEX IF NOT EXISTS "CourseReview_userId_createdAt_idx" ON "CourseReview"("userId", "createdAt");

UPDATE "Course" c
SET
  "averageRating" = COALESCE((
    SELECT AVG(cr."rating")::DOUBLE PRECISION
    FROM "CourseReview" cr
    WHERE cr."courseId" = c."id"
  ), 0),
  "reviewCount" = COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM "CourseReview" cr
    WHERE cr."courseId" = c."id"
  ), 0);
