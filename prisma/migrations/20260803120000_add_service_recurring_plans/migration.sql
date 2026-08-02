-- Per-service, admin-controlled "Recurring plans" marketing cards. Amounts are
-- display strings (never summed by the pricing engine). recurringHeading is the
-- section title shown on the service page.
ALTER TABLE "Service" ADD COLUMN "recurringHeading" TEXT;

CREATE TABLE "ServiceRecurringPlan" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "freq" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "unit" TEXT,
    "disc" TEXT,
    "best" BOOLEAN NOT NULL DEFAULT false,
    "cta" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRecurringPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceRecurringPlan_serviceId_active_sortOrder_idx" ON "ServiceRecurringPlan"("serviceId", "active", "sortOrder");

ALTER TABLE "ServiceRecurringPlan" ADD CONSTRAINT "ServiceRecurringPlan_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
