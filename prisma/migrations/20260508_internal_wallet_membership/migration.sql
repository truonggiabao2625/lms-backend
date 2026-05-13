CREATE TYPE "MemberTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND');
CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP', 'COURSE_PURCHASE', 'REFUND', 'ADJUSTMENT');

ALTER TABLE "User"
ADD COLUMN "walletBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalSpent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "memberTier" "MemberTier" NOT NULL DEFAULT 'BRONZE';

CREATE TABLE "WalletTransaction" (
  "id" TEXT NOT NULL,
  "type" "WalletTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "note" TEXT,
  "userId" TEXT NOT NULL,
  "courseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");
CREATE INDEX "WalletTransaction_courseId_idx" ON "WalletTransaction"("courseId");

ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
