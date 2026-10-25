# API-контракт «Прогноз кассовых разрывов»

> Фиксируется до параллельной разработки фронта и бэка (ТЗ §8). Формат — JSON.
> Базовый путь: `/api`. Все эндпоинты, кроме `/auth/register` и `/auth/login`,
> требуют `Authorization: Bearer <token>`.

## Формат ошибки

Единый формат: `4xx/5xx → { "error": { "code": "STRING", "message": "STRING" } }`

| Код | HTTP | Когда |
|---|---|---|
| `UNAUTHENTICATED` | 401 | нет/истёк токен |
| `INVALID_CREDENTIALS` | 401 | неверный email/пароль при `/auth/login` |
| `UNAUTHORIZED` | 403 | нет доступа к ресурсу (чужие данные) |
| `NOT_FOUND` | 404 | ресурс не найден |
| `VALIDATION` | 400/422 | ошибка валидации (в message — поле): 400 — body/query (например, horizon), 422 — файл/колонки при импорте |
| `RISK_NOT_DELETABLE` | 400 | попытка удалить авто-риск |
| `FILE_INVALID` | 422 | файл выписки: формат/размер/колонки |
| `RATE_LIMITED` | 429 | rate limit: 300 запросов / мин на `/api/*`, 10 / мин на `/auth/*` |
| `INTERNAL` | 500 | ошибка сервера |

## Общие типы

```ts
User { id, email, companyName, inn, minBalance }
Operation {
  id, date: "YYYY-MM-DD", amount: number > 0,
  direction: "in" | "out",
  category: "income" | "expense" | "payment" | "tax" | "salary" | "other",
  counterpartyName: string,   // обезличено
  counterpartyInn: string,    // обезличено
  purpose: string,
  balanceEndOfDay: number,
  source: "import" | "manual" | "bank_stub" | "self_loan" | "bank_loan" | "payment"
}
Risk {
  id, title,
  type: "income_loss" | "unplanned_expense",
  amount: number, dateFrom: "YYYY-MM-DD", dateTo: string | null,
  probability: number 0..1,
  source: "auto" | "manual", active: boolean
}
ForecastResult {
  series: [{ date, income, expense, balance }],   // по дням горизонта
  gapDate: string | null,
  gapProbabilityPct: number 0..100,
  gapAmount: number
}
Paged<T> { items: T[], total: number, page: number, pages: number }
```

**Обезличивание** (ТЗ §5.5, §7): `counterpartyName` = первые 2 символа + `***`
(например, `ОО***`); `counterpartyInn` = `77******12`. Выполняется при сохранении импорта; полные данные в БД не хранятся.

## Эндпоинты

### POST /auth/register — multipart/form-data

Поля: `email`, `password` (≥ 8), `companyName`, `inn` (10 или 12 цифр),
либо `file` (csv/xlsx ≤ 5 МБ), либо `useDemoData=true` (seed-набор, обязателен для демо).

- `201` → `{ "token": "…", "user": User }` — пользователь сразу залогинен.
- Ошибки: `409 CONFLICT` (email занят), `422 VALIDATION`, `422 FILE_INVALID`.

### POST /auth/login

`{ "email", "password" }` → `200 { "token", "user" }`; `401 UNAUTHENTICATED`.

### GET /auth/me → `{ "user": User }`

### PATCH /user
### PATCH /auth/user

- Тело: произвольное `{ "companyName?" , "inn?" , "minBalance?" }`; `minBalance` — порог разрыва T (₽, ≥ 0),
  влияет на `dangerDays` и блок разрыва в прогнозе (ТЗ §14: настраивается пользователем, по умолчанию 0).
- `200` → обновлённый `User`.

### Шаблон выписки (CSV)

На странице регистрации предоставляется шаблон `client/public/statement-template.csv` (с BOM — для Excel).
Колонки:

| Колонка | Пример |
|---|---|
| `Дата` | `25.01.2026` (дд.мм.гггг) |
| `Контрагент` | `ООО Ромашка` |
| `ИНН контрагента` | `7701234567` (необязательно) |
| `Назначение` | `Оплата по счёту №12` |
| `Сумма` | `−45000` (расходы отрицательные, доходы положительные, ₽) |

Порядок колонок произвольный. Неизвестные колонки / битая строка → `422 FILE_INVALID` (message с указанием строки).

### GET /dashboard?horizon=30|60|90 (по умолчанию 30)

```json
{
  "currentBalance": 1234567.89,
  "threshold": 0,
  "loanRatePct": 9.5,
  "asOf": "2026-09-29",
  "meta": { "computed": "full", "computedMs": 42 },
  "summary": { "income": 0, "expense": 0, "balanceChange": 0, "balance": 0 },
  "gapDate": "2026-11-02",
  "gapProbabilityPct": 64,
  "gapAmount": 185000,
  "gapAmountMedian": 150000,
  "gapAmountP90": 320000,
  "probableGapDate": "2026-11-02",
  "alreadyBelowThreshold": false,
  "dangerProbabilityByDay": [0, 1, 4],
  "cumulativeGapProbabilityByDay": [0, 1, 5],
  "minForecastBalance": -185000,
  "forecastSeries": [{ "date": "2026-09-30", "income": 0, "expense": 0, "balance": 0, "balanceLow": 0, "balanceMedian": 0, "balanceHigh": 0 }],
  "dangerDays": ["2026-11-02"],
  "goodDays": ["2026-11-15"],
  "regularPayments": [{ "amount": 45000, "every": "monthly", "lastDate": "2026-09-05", "confidence": 0.9 }],
  "dataQuality": {
    "level": "good",
    "asOf": "2026-09-29",
    "gapsDays": 0,
    "gaps": [{ "from": "2026-01-01", "to": "2026-01-03" }],
    "emptyInnRows": 12,
    "emptyPurposeRows": 3,
    "overdraftDays": 0,
    "historyLevel": "full",
    "historyDays": 720
  }
}
```

- `currentBalance` — остаток на опорную дату (отдельное `balance` в сумме нет: `summary.balance` = текущий остаток).
- `loanRatePct` (опционально): условная ставка банковского займа, % — фиксированная константа
  из конфига бэкенда; отображается на странице «Запрос у банка» (ТЗ §5.7).
- `asOf` (top-level, дублируется в `dataQuality.asOf`): опорная дата прогноза (ТЗ-доработка §9):
  свежая выписка (≤ 3 дн.) — текущая дата, старая — последняя дата выписки; `FORECAST_AS_OF`
  из `server/.env` применяется только к демо-учётке `demo@cashflow.ru`.
- `meta.computed` (ТЗ-доработка WP-8 п.7): сейчас всегда `"full"` + время расчёта в мс.
  Инкрементальное обновление без полного пересчёта (`"incremental"`, состояние `ForecastState`)
  — только в «планах развития» (docs/ARCHITECTURE.md §8), не реализовано.
- `dataQuality` — слитое поле качества (ТЗ-доработка §1, §10): уровень ядра (`level`),
  пропуски (`gapsDays`, `gaps`), пустые ИНН/назначения, овердрафт (`overdraftDays`) —
  из него клиент рендерит алерты; `historyLevel: "insufficient"` при истории < 14 дней
  (тогда Монте-Карло не запускается: `gapProbabilityPct` и квантили разрыва — `null`).
- `summary` — итоги за 30 дней от опорной даты (`asOf − 30 дн … asOf`), а не от сегодня.
- `gapProbabilityPct` — вероятность, что разрыв случится в течение горизонта; при `mcDisabled` — `null`.

### GET /dashboard/plan-fact?month=YYYY-MM

План-факт месяца (WP-6): `POST /planned-events` создаёт «план» на месяц; ответ:

```json
{ "month": "2026-11", "netPlan": -120000, "netActual": -180000, "diff": -60000, "planEvents": 4, "frozen": false }
```

- `frozen=true` — месяц закрыт (факт зафиксирован, план пересчитывается только от него).

### GET /operations?month=YYYY-MM&category=&page=1&limit=20

`category`: `income|expense|payment|tax|salary|other` или пусто (= все). → `Paged<Operation>`.

### GET /operations/:id → `Operation` (404 при отсутствии / не владельца)

### POST /operations

```json
{ "date": "2026-10-25", "amount": 15000, "direction": "out", "counterpartyName": "ИП Смирнов", "purpose": "Аренда офиса" }
```
→ `201 Operation` (`source="manual"`, `balanceEndOfDay` считает сервер).

### POST /operations/import — multipart/form-data

Поле `file`: CSV (BOM, `;`/`,`/таб — автоопределение разделителя) или XLSX, ≤ 25 МБ.
Категория каждой операции вычисляется категоризатором (WP-3), кроме `categorySource="manual"`.
→ `201`:

```json
{ "rowsTotal": 1000, "imported": 980, "skipped": 20, "duplicatesRemoved": 3, "possibleDuplicates": 1, "warnings": ["…"], "dataQuality": { "…": "см. /dashboard" }, "removed": 0, "format": "organizer", "companyId": "C001" }
```

- 422 `FILE_INVALID` — формат/размер/колонки (пользователь не создаётся, если импорт — часть регистрации).
- Двойной импорт того же файла не дублирует операции (по `externalId`).

### POST /operations/bulk

Массив операций в теле `{ "operations": [Operation…] }` → `201 { "imported": N, "asOf": "YYYY-MM-DD" }`.

### POST /operations/reassign

`{ "fromDate": "YYYY-MM-DD", "toDate": "YYYY-MM-DD", "category": "tax" }` → `{ "updated": N }`
(перекатегоризация диапазона, `categorySource="manual"`).

### PATCH /operations/:id

Тело: `{ "subcategory": "rent" }` — значение только из таксономии (см. `GET /categories`);
меняет категорию и ставит `categorySource="manual"` (ТЗ-доработка §8 п.8). → `200 Operation`.
`404 NOT_FOUND` — нет/не владельца.

### GET /history/summary?month=YYYY-MM&category=

`category`: `income|expense|payment` или пусто (= все операции месяца).

```json
{ "month": "2026-09", "total": 540000, "groups": [ { "key": "tax", "label": "Налоги", "amount": 120000 } ] }
```
Группы: для расходов — по категориям, для доходов — по контрагентам.

### GET /risks → `Risk[]`
### POST /risks

```json
{ "title": "Срыв поставки", "type": "income_loss", "amount": 200000, "dateFrom": "2026-11-01", "dateTo": "2026-11-15", "probability": 0.4 }
```
→ `201 Risk` (`source="manual"`, `active` по умолчанию `true`).

### PATCH /risks/:id

Любое подмножество: `{ "active": false }`, `{ "amount": 150000, "probability": 0.3 }` → `Risk`.

### DELETE /risks/:id → `204`; для `source="auto"` → `400 RISK_NOT_DELETABLE`.

### GET /planned-events?type=&source=

Плановые события (налоги, аренда, договоры, WP-4): `{ "events": [PlannedEvent], "summary": { "totalExpectedIn", "totalExpectedOut", "upcomingTaxes", "overdueCount", "highRiskInAmount" } }`.
`PlannedEvent`: `{ id, title, type: "tax" | "rent" | "contract" | "salary" | "other", direction: "in" | "out", amount, expectedDate, issueDate?, deferralDays?, prepaymentPct?, counterpartyRisk?, source: "manual" | "system" | "tax-calendar", status: "pending" | "paid" | "overdue", active }`.

### POST /planned-events

```json
{ "title": "Аренда офиса", "type": "rent", "direction": "out", "amount": 250000, "expectedDate": "2026-11-05", "deferralDays": 14, "prepaymentPct": 30 }
```
- Договор (А, ТЗ-доп. §4.1): `0 < prepaymentPct < 100` → две записи (предоплата + постоплата с отсрочкой `deferralDays`).
- → `201 { "events": [PlannedEvent] }`.

### PATCH /planned-events/:id

Подмножество: `{ "active": false }`, `{ "status": "paid" }`, `{ "amount": 200000 }` → `{ "event": PlannedEvent }`.

### GET /categories

Таксономия категоризатора (WP-3): `[{ "id": "tax", "subcategoryIds": ["vat", "income_tax", …], "labels": { "vat": "НДС", … } }]`.

### GET /counterparty?name=&inn=

Проверка контрагента (заглушка, WP-6): `{ "name", "inn", "riskLevel": "low" | "medium" | "high", "notes" }`.

### GET /demo/companies

Демо-выписки из `test-data/demo/` (ТЗ-доработка п.13): `{ "companies": [{ "file", "label" }] }`.

### POST /demo

Загрузка выбранной демо-выписки в учётку: `{ "file": "statement-demo-C001.csv" }`
→ `201 { "file", "operationsImported", "replaced", "asOf", "rowErrors" }`
(старые операции с `source="demo"` заменяются; `asOf` — последняя дата выписки).

### GET /gap/self-loans → `{ "items": [Operation] }` (операции с `source="self_loan"`)

### POST /gap/self-loan

`{ "amount": 185000 }` (amount > 0) → `{ "operation": Operation }`
(`source="self_loan"`, дата = дата ближайшего разрыва; прогноз пересчитывается).

### DELETE /gap/self-loan/:operationId → `204` (операция удаляется, прогноз пересчитывается)

### POST /bank/loan (заглушка, задержка 500–1000 мс)

`{ "amount": 185000, "termDays": 90 }` →
`{ "status": "approved", "ratePct": 14.5, "operation": Operation }`
(`source="bank_loan"`; `ratePct` — константа из конфига бэкенда).

### POST /bank/connect (заглушка)

→ `{ "connected": true, "provider": "stub" }` (подключение банка — заглушка WP-6).

### POST /bank/sync (заглушка)

Синхронизация выписок: → `{ "synced": true, "new": N, "operations": [Operation] }` (`source="bank_stub"`).

### GET /bank/accounts (заглушка)

→ `[]` (список счетов; заглушка пока пустая).

### POST /bank/payments (заглушка, задержка 500–1000 мс)

```json
{ "type": "tax", "recipient": "ФНС", "amount": 90000, "date": "2026-10-28", "purpose": "НДС" }
```
`type`: `tax|salary|rent|supplier|other` (аренда/поставщики мапятся на категорию `other`).

```json
{
  "status": "accepted",
  "operation": { "…": "…" },
  "warning": { "gapGrows": true, "newGapAmount": 240000, "message": "Платёж увеличивает кассовый разрыв" }
}
```
`warning` опционален — приchodzi только если расчёт показывает рост разрыва.

### GET /bank/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD (заглушка)

→ `{ "operations": [Operation] }` (`source="bank_stub"`).

### POST /sandbox/simulate

```json
{ "name": "Покупка автомобиля", "amount": 600000, "date": "2026-11-01", "direction": "out", "repeats": 1 }
```
`repeats ≥ 1` (1 = одноразово, N = ежемесячно N раз).

```json
{
  "base":     { "series": [], "gapDate": "2026-11-02", "gapProbabilityPct": 64, "gapAmount": 185000 },
  "scenario": { "series": [], "gapDate": "2026-10-28", "gapProbabilityPct": 87, "gapAmount": 512000 },
  "delta": { "gapProbabilityPct": 23, "gapAmount": 327000 }
}
```
`delta = scenario − base` (п.п. для вероятности, рубли для суммы; отрицательное = разрыв стал меньше).
Сценарий **не сохраняется** в реальные операции.

### POST /sandbox/reset

Удаляет сохранённые карточки сценариев пользователя (localStorage/БД) → `{ "message": "Sandbox reset successfully" }`.

### GET /calendar/month?month=YYYY-MM
### GET /calendar/events?month=YYYY-MM

```json
{
  "month": "2026-11",
  "days": [
    {
      "date": "2026-11-02",
      "status": "danger",
      "expectedIncome": 0,
      "expectedExpense": 240000,
      "expectedBalance": -185000,
      "reasons": ["Налог НДС", "Зарплата", "Автоматический риск: сезонный спад"]
    }
  ]
}
```
`status`: `danger` (остаток < порога / топ-по отрицательному дневному изменению) | `good` (доход > среднего дневного × 1,2) | `neutral`.

### POST /support/tickets

`{ "subject", "kind": "problem" | "question", "message" }` → `201 { "id", "status": "new" }`

### GET /support/tickets → `SupportTicket[]` (только свои, newest first)

### POST /integrations/:provider/sync

Подключение интеграции (WP-6, заглушки): `:provider` — `tax-calendar` (налоговый календарь ФНС:
создаёт `planned-event`'ы-налоги на квартал) или `counterparty` (проверка контрагентов, отчёт).
→ `201 { "ok": true, "provider", "label", "created": N, "events": [PlannedEvent] }`.

### DELETE /integrations/:provider/sync

Отключение (WP-6): → `201` и снятие событий интеграции (provider-specific).

### GET /integrations/counterparty?month=YYYY-MM

Отчёт по проверкам контрагентов за месяц (заглушка WP-6).

## ТЗ-доработка WP-4: негативные сценарии «что если»

Сценарии применяются **внутри расчётного ядра** (через `options.scenarios` в `calculateForecast`), а не
подменой фиктивных операций (legacy-режим песочницы `POST /sandbox/simulate` остаётся).
Описание типов, диапазонов и формул — `docs/SCENARIOS.md`.

### POST /scenarios/simulate

Тело: `{ scenarios: [ { type, params }, … ] (1–4, разные типы), horizonDays? }`. Типы и параметры:
`client_delay { inn, days 14..28 }`, `revenue_drop { percent 0..30, fromDate?, durationDays? }`,
`unplanned_expense { amount?, date? }` (amount не задан = нулевой сценарий; date не раньше завтра),
`fixed_costs_growth { percent 0..50, fromDate? }`. Горизонт и порог — как у главного прогноза.

→ `200 { base, scenario, isolated[], delta, asOf, scenarios }`, где `base`/`scenario` —
`{ series: [{ date, balance, p10, p90 }], gapDate, gapAmount, gapProbabilityPct, minBalance, dangerDays, threshold }`,
`isolated` — каждый тип отдельно, `delta = { gapDateShiftDays, gapAmount, gapProbabilityPct, minBalance }`.
`400 VALIDATION` — нарушены границы (5 сценариев, дубликат типа, percent за пределами, days вне 14–28,
неизвестный type, дата расхода раньше завтра). Каждый выбранный сценарий сохраняется карточкой
`SandboxScenario` (`kind` — тип, `params` — JSON; legacy остаётся `kind: 'custom_event'`).

### GET /scenarios/clients

Топ-5 контрагентов по доле в поступлениях за последние 6 месяцев:
→ `200 { clients: [{ inn, name, totalIn6m, sharePct }], windowMonths: 6 }` — для prefill в `client_delay`.

### GET /scenarios/defaults

Дефолт параметра `unplanned_expense.amount` из истории (отчёт §8.4):
→ `200 { unplannedExpense: { amount, basis: "history_median" } | null }` —
amount = медиана unplanned_* списаний (нет истории → `null`, ввод «с нуля»).

## ТЗ-доработка WP-5: график «План-факт»

### GET /plan-fact?days=30|60|90&granularity=day|week

План — прогноз (mean90), построенный на `cut = начало периода − 1 день` по данным и
плановым событиям, известным на `cut` (`issueDate ≤ cut`); факт — операции периода без
`subcategory ∈ {own_funds_in, own_funds_out, loan_in}`.
→ `200 { days, granularity, cut, base: 'mean90', periods: [{ from, to, planIn, planOut, factIn, factOut, planNet, factNet, deviationNet, significant }] }`,
где `significant = true`, если `|factNet − planNet| ≥ max(10 % от |planNet|, 10 000 ₽)`.
Если до `cut` меньше 90 дней истории — `400 { error: { code: 'VALIDATION', message } }`.

### GET /plan-fact/gap-breakdown?days=30|60|90

Разбивка «из чего складывается нехватка» на горизонте (показывается на Главной рядом с найденным разрывом):
обязательные платежи (PlannedEvent pending/overdue) / внеплановые резервы (unplanned_* за 12 мес.) / ожидаемые поступления.

```json
{ "days": 30, "asOf": "2026-09-29", "mandatoryOut": 1400000, "mandatoryCount": 5, "expectedIn": 150487.8, "expectedInCount": 1, "unplannedReserve": 900000, "unplannedBasis": "sum_12m", "unplannedCount": 1 }
```

- `unplannedBasis`: `sum_12m` — сумма unplanned_* списаний за 12 мес.; `median_fallback_12m` — медиана всех списаний (нет unplanned_*).
- `unplannedReserve` — `null`, если истории < 3 списаний.

Статусы плановых событий сверки (`pending` / `paid` / `partial` / `paid_late` / `overdue`)
обновляются автоматически: перед `GET /dashboard`, `GET /planned-events` и после
`POST /operations`, импорта выписки/пакетного импорта и `GET /bank/transactions`.
Ответ `GET /dashboard` содержит `alerts: [{ id, type, severity, title, message, date, amount }]`
(`planned_overdue`, `regular_missing` — severity `warning`; при появлении разрыва —
дополнительно `gap_forecast`, severity `critical`).

## Демо-данные

Seed создаёт демо-учётку `demo@cashflow.ru / demo1234` (контракт) — выписки берутся из
`test-data/demo/` (сейчас 1 демо-выписка `statement-demo-C001.csv`; механика выбора
`server/scripts/pick-demo.mjs` готова под датасет организаторов — 150 компаний / 15 видов:
после подстановки в `test-data/statements/` добавятся 2–3 компании с реальным разрывом;
ТЗ-доработка п.13), а не из генератора. Seed также задаёт демо-учётке порог разрыва
T = P25-квантиль остатков выписки и плановые события (договор, счёт, налог, просроченный
платёж) — на C001/asOf=2026-09-29 на главной виден будущий разрыв (docs/BACKTEST.md:
на C001 разрыв случился при пороге P25).
`FORECAST_AS_OF` в `server/.env` = последняя дата демо-выписки — применяется **только**
к демо-учётке (у обычных пользователей `asOf` берётся из их выписки, ТЗ-доработка §9).
Кнопка «Использовать демо-данные» → `POST /demo` (см. `test-data/README.md`).

## Примечания

- Все деньги — рубли (`number`); фронт форматирует `1 234 567,89 ₽`.
- Горизонт прогноза: только 30/60/90 дней.
- Монте-Карло: N = 1000, фиксированный seed → воспроизводимость результата.
