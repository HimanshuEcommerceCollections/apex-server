-- Add admin-controlled response-time label to Area (nullable, non-destructive).
ALTER TABLE "Area" ADD COLUMN "duration" TEXT;
