-- CreateTable
CREATE TABLE "PlannedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "expectedDate" DATETIME NOT NULL,
    "issueDate" DATETIME,
    "deferralDays" INTEGER NOT NULL DEFAULT 0,
    "prepaymentPct" REAL,
    "counterpartyName" TEXT,
    "counterpartyInn" TEXT,
    "counterpartyRisk" TEXT NOT NULL DEFAULT 'low',
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannedEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "categoryConfidence" REAL,
    "categorySource" TEXT NOT NULL DEFAULT 'rule',
    "counterpartyName" TEXT NOT NULL,
    "counterpartyInn" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "balanceEndOfDay" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Operation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Operation" ("amount", "balanceEndOfDay", "category", "counterpartyInn", "counterpartyName", "createdAt", "date", "direction", "id", "purpose", "source", "userId") SELECT "amount", "balanceEndOfDay", "category", "counterpartyInn", "counterpartyName", "createdAt", "date", "direction", "id", "purpose", "source", "userId" FROM "Operation";
DROP TABLE "Operation";
ALTER TABLE "new_Operation" RENAME TO "Operation";
CREATE INDEX "Operation_userId_date_idx" ON "Operation"("userId", "date");
CREATE UNIQUE INDEX "Operation_userId_externalId_key" ON "Operation"("userId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlannedEvent_userId_expectedDate_idx" ON "PlannedEvent"("userId", "expectedDate");

