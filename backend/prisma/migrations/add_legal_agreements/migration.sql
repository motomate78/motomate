-- Add legal agreement fields to users table
ALTER TABLE "users" ADD COLUMN "agreed_privacy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "agreed_cookies" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "agreed_license" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "agreed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
