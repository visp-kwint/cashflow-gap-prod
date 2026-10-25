# Cashflow Gap — прогноз кассовых разрывов (хакаатон 2026)

Сервис для малого бизнеса и ИП: по истории операций по банковскому счёту
детерминированно прогнозирует кассовые разрывы (дата, вероятность, сумма) и
предлагает закрыть разрыв — «занять у себя» или «запрос у банка» (заглушка).
Поддерживает негативные сценарии «что если», сверку «План-факт», налоговый
календарь и проверку контрагентов; внешние интеграции — детерминированные
заглушки.

## Запуск (с нуля, ≤ 5 шагов)

1. `git clone` → `npm install` (корень: ставит `concurrently`)
2. `npm run setup` — зависимости клиента и сервера, `prisma migrate deploy`
   (создание БД по миграциям из `server/prisma/migrations/`), сид; создаёт
   `server/.env` с JWT_SECRET, если файла нет
3. `npm run dev` — сервер http://localhost:5000 и клиент
   http://localhost:5173 одновременно (проброс `/api` → `5000`)
4. Открыть http://localhost:5173 → войти `demo@cashflow.ru` / `demo1234`
   (сид из шага 2; контракт docs/api-contract.md), или «Регистрация» —
   загрузка выписки CSV/XLSX по шаблону `client/public/statement-template.csv`
5. В пустом состоянии — кнопка «Использовать демо-данные»: выписки из
   `test-data/demo/` (выбирает `server/scripts/pick-demo.mjs` из датасета
   организаторов в `test-data/statements/`; см. `test-data/README.md`)

## Переменные окружения

| Переменная | Где | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `PORT` | server/.env | `5000` | порт API |
| `DATABASE_URL` | server/.env | `file:./dev.db` | SQLite |
| `JWT_SECRET` | server/.env | — (обязательно, ≥ 32 симв.) | подпись JWT |
| `JWT_EXPIRES_IN` | server/.env | `24h` | срок жизни токена |
| `CORS_ORIGINS` | server/.env | `http://localhost:5173` | разрешённые origin (через запятую) |
| `NODE_ENV` | server/.env | `development` | в production заглушка `JWT_SECRET` запрещена |
| `FORECAST_AS_OF` | server/.env | — | опорная дата прогноза (**только для демо-учётки** `demo@cashflow.ru`; обычные пользователи берут asOf из своей выписки, ТЗ-доработка §9) |
| `VITE_PROXY_TARGET` | client/.env(.local) | `http://localhost:5000` | цель прокси `/api` |

## Команды (корень)

| Команда | Что делает |
| --- | --- |
| `npm run setup` | зависимости + `prisma migrate deploy` + seed (+ `.env`) |
| `npm run dev` | сервер + клиент одновременно (concurrently) |
| `npm test` | тесты сервера (vitest) |
| `npm run lint` | lint клиента и сервера |
| `npm run build` | сборка клиента → `client/dist` |
| `npm run backtest` | бэктест на датасете (`-- test-data/statements`) → `docs/BACKTEST.md` + `docs/backtest-results.json`; `-- --models all` (из `server/`) создаёт ещё `docs/MODEL_COMPARISON.md` (WP-2) |
| `npm run verify` (из `client/`) | headless-проверки (build, design, TZ-зазоры) |

## Структура репозитория

```
client/          React + Vite + TS + Tailwind + Recharts + Zustand
server/          Express + Prisma/SQLite; routes → middleware (auth,
                 validate, rate limit) → controllers → services;
                 сервисы-ядро — чистые функции без БД (forecast,
                 categorizer, planFact, taxCalendar, сценарии)
test-data/       C001.csv (пример), demo/ (демо-выписки), statements/
                 (датасет организаторов — НЕ коммитится, test-data/README.md)
docs/            api-contract.md, ARCHITECTURE.md, BACKTEST.md,
                 CATEGORIZATION.md, SECURITY.md, SCENARIOS.md (WP-4),
                 MODEL_COMPARISON.md (WP-2), img/ (скриншоты), internal/ (архивные ТЗ)
```

## Документация

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — схема (Mermaid) и описание
- [`docs/api-contract.md`](docs/api-contract.md) — контракт API
  (машинная сверка `server/scripts/check-contract.mjs`)
- [`docs/SECURITY.md`](docs/SECURITY.md) — «угроза / мера / где реализовано»
- [`docs/BACKTEST.md`](docs/BACKTEST.md) + `docs/backtest-results.json`
- [`docs/MODEL_COMPARISON.md`](docs/MODEL_COMPARISON.md) — сравнение 7 подходов + абляция (WP-2; создаётся командой `npm run backtest -- test-data/statements -- --models all`)
- [`docs/CATEGORIZATION.md`](docs/CATEGORIZATION.md)
- [`docs/SCENARIOS.md`](docs/SCENARIOS.md) — описания и формулы сценариев «что если» (WP-4)
- Скриншоты интерфейса (WP-9): [`docs/img/dashboard.png`](docs/img/dashboard.png) — главная с разрывом, [`docs/img/plan-fact.png`](docs/img/plan-fact.png) — план-факт, [`docs/img/scenario.png`](docs/img/scenario.png) — сценарий «что если», [`docs/img/history.png`](docs/img/history.png) — история с диаграммой категорий

## Ограничения и допущения

1. Интеграции (1С, ЭДО, банк, маркетплейс, реестр контрагентов) —
   **заглушки** с детерминированными тестовыми данными за
   `AdapterInterface`; реальные адаптеры подключаются без изменений
   контроллера.
2. Налоговый календарь использует **зашитые ставки и правила** — сервис не
   является налоговой консультацией.
3. Прогноз **детерминирован, без ML**; точность — бэктестом (WP-1) и
   сравнением подходов (WP-2). ML-модуль подключается точечно
   (`calculateForecast` / `forecast.baselines`), клиентский контракт
   не меняется.
4. Хранение — SQLite (допустимо для хакаатона); переход на PostgreSQL
   меняет только `provider` в `schema.prisma`.
5. Бэктест и сравнение моделей выполняются на датасете организаторов
   (`test-data/statements/`, не коммитится); в репозитории — пример
   `C001.csv` и выбранные демо-файлы.
6. Сценарии «что если» не создают и не меняют операции и риски — только
   оверлей на прогнозе; история запусков хранится в `SandboxScenario`.
7. Проверка контрагента — **демо-правило**: риск определяется последними
   двумя цифрами ИНН (12/99/66 → high, 44/55/77 → medium, остальные → low),
   а не реальными реестрами ФНС/Федресурс; видно в ответе `GET /api/counterparty`
   (поля `riskLevel`, `badgeText`) и в поле `counterpartyRisk` плановых событий.
