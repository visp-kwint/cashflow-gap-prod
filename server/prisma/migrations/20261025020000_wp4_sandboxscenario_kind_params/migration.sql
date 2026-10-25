-- ТЗ-доработка WP-4: SandboxScenario получает тип сценария (kind) и JSON-параметры (params)
-- Legacy-записи (синтетические операции песочницы) — kind = 'custom_event' (default).
ALTER TABLE "SandboxScenario" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'custom_event';
ALTER TABLE "SandboxScenario" ADD COLUMN "params" TEXT;
