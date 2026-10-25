-- Отчёт §8 (минимальный вариант): Operation получает класс плановости и метаданные вывода.
ALTER TABLE "Operation" ADD COLUMN "plannedness" TEXT;
ALTER TABLE "Operation" ADD COLUMN "plannednessConfidence" REAL;
ALTER TABLE "Operation" ADD COLUMN "plannednessSource" TEXT DEFAULT 'rule';
