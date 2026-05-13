DO $$
BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MOCK', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ExternalPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PurchaseStatus" AS ENUM ('COMPLETED', 'REFUNDED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'COURSE_REMINDER', 'COURSE_COMPLETED', 'CERTIFICATE_ISSUED', 'STREAK_REMINDER', 'PAYMENT_SUCCESS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Course"
ALTER COLUMN "price" TYPE INTEGER USING ROUND("price")::INTEGER;

ALTER TABLE "Lesson"
ADD COLUMN IF NOT EXISTS "durationSeconds" INTEGER;

ALTER TABLE "Enrollment"
ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "LessonProgress"
ALTER COLUMN "isCompleted" SET DEFAULT false;

ALTER TABLE "LessonProgress"
ADD COLUMN IF NOT EXISTS "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "WalletTransaction"
ADD COLUMN IF NOT EXISTS "metadata" JSONB,
ADD COLUMN IF NOT EXISTS "purchaseId" TEXT,
ADD COLUMN IF NOT EXISTS "externalPaymentId" TEXT;

CREATE TABLE IF NOT EXISTS "Purchase" (
  "id" TEXT NOT NULL,
  "originalAmount" INTEGER NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "finalAmount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "status" "PurchaseStatus" NOT NULL DEFAULT 'COMPLETED',
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExternalPayment" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "status" "ExternalPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "note" TEXT,
  "providerSessionId" TEXT NOT NULL,
  "providerPaymentIntentId" TEXT,
  "completedAt" TIMESTAMP(3),
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProcessedWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "payload" JSONB,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Certificate" (
  "id" TEXT NOT NULL,
  "certificateNo" TEXT NOT NULL,
  "verifyCode" TEXT NOT NULL,
  "pdfUrl" TEXT,
  "completionSnapshot" JSONB,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Course_isPublished_createdAt_idx" ON "Course"("isPublished", "createdAt");
CREATE INDEX IF NOT EXISTS "Enrollment_courseId_createdAt_idx" ON "Enrollment"("courseId", "createdAt");
CREATE INDEX IF NOT EXISTS "Enrollment_userId_updatedAt_idx" ON "Enrollment"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "LessonProgress_userId_isCompleted_idx" ON "LessonProgress"("userId", "isCompleted");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_purchaseId_key" ON "WalletTransaction"("purchaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_externalPaymentId_key" ON "WalletTransaction"("externalPaymentId");
CREATE INDEX IF NOT EXISTS "WalletTransaction_type_createdAt_idx" ON "WalletTransaction"("type", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_userId_courseId_key" ON "Purchase"("userId", "courseId");
CREATE INDEX IF NOT EXISTS "Purchase_courseId_createdAt_idx" ON "Purchase"("courseId", "createdAt");
CREATE INDEX IF NOT EXISTS "Purchase_userId_createdAt_idx" ON "Purchase"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalPayment_providerSessionId_key" ON "ExternalPayment"("providerSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalPayment_providerPaymentIntentId_key" ON "ExternalPayment"("providerPaymentIntentId");
CREATE INDEX IF NOT EXISTS "ExternalPayment_userId_createdAt_idx" ON "ExternalPayment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ExternalPayment_status_createdAt_idx" ON "ExternalPayment"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedWebhookEvent_providerEventId_key" ON "ProcessedWebhookEvent"("providerEventId");
CREATE INDEX IF NOT EXISTS "ProcessedWebhookEvent_provider_processedAt_idx" ON "ProcessedWebhookEvent"("provider", "processedAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Certificate_certificateNo_key" ON "Certificate"("certificateNo");
CREATE UNIQUE INDEX IF NOT EXISTS "Certificate_verifyCode_key" ON "Certificate"("verifyCode");
CREATE UNIQUE INDEX IF NOT EXISTS "Certificate_userId_courseId_key" ON "Certificate"("userId", "courseId");
CREATE INDEX IF NOT EXISTS "Certificate_courseId_issuedAt_idx" ON "Certificate"("courseId", "issuedAt");
CREATE INDEX IF NOT EXISTS "Certificate_userId_issuedAt_idx" ON "Certificate"("userId", "issuedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WalletTransaction_purchaseId_fkey'
  ) THEN
    ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WalletTransaction_externalPaymentId_fkey'
  ) THEN
    ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_externalPaymentId_fkey"
    FOREIGN KEY ("externalPaymentId") REFERENCES "ExternalPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_userId_fkey'
  ) THEN
    ALTER TABLE "Purchase"
    ADD CONSTRAINT "Purchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Purchase_courseId_fkey'
  ) THEN
    ALTER TABLE "Purchase"
    ADD CONSTRAINT "Purchase_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExternalPayment_userId_fkey'
  ) THEN
    ALTER TABLE "ExternalPayment"
    ADD CONSTRAINT "ExternalPayment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey'
  ) THEN
    ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Certificate_userId_fkey'
  ) THEN
    ALTER TABLE "Certificate"
    ADD CONSTRAINT "Certificate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Certificate_courseId_fkey'
  ) THEN
    ALTER TABLE "Certificate"
    ADD CONSTRAINT "Certificate_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
