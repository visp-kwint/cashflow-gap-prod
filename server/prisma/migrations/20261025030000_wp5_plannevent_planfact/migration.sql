-- ТЗ-доработка WP-5: PlannedEvent получает поля сверки план-факт.
ALTER TABLE "PlannedEvent" ADD COLUMN "paidAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PlannedEvent" ADD COLUMN "factOperationId" TEXT;
ALTER TABLE "PlannedEvent" ADD COLUMN "deviationDays" INTEGER;
