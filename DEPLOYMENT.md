# Backend deployment checklist

## 1. Environment variables

- Do not commit `.env` to Git.
- Use a separate secret set for `local`, `staging`, and `production`.
- Rotate all secrets immediately if `.env` was ever pushed to a remote repository.
- Required variables:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `FRONTEND_URL`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `CLOUDINARY_*` when video or avatar upload is enabled

## 2. Prisma migration flow

Run these commands in CI or on the deployment host:

```bash
npx prisma generate
npx prisma migrate deploy
```

## 3. Database backup policy

- Enable automated daily backups on the production database.
- Keep at least:
  - 7 daily backups
  - 4 weekly backups
- If your provider supports PITR, enable it.
- Test restore to a staging database on a schedule. Backup only matters if restore works.

## 4. Wallet and payment safety checks

- Verify `STRIPE_WEBHOOK_SECRET` in production before enabling card payments.
- Monitor duplicate webhook attempts and failed payment events.
- Keep application logs for:
  - wallet top-up
  - course purchase
  - refund or adjustment
- Do not edit wallet balances directly in SQL outside an audited admin workflow.

## 5. Post-deploy smoke test

- Register a fresh student account
- Top up wallet in mock or Stripe test mode
- Buy a paid course
- Complete lessons until 100%
- Verify:
  - wallet balance decreases correctly
  - `Purchase` row exists
  - `WalletTransaction` row exists
  - `Certificate` is issued at 100%
  - notification records are created
