# Безопасность (WP-6)

Описание мер по пунктам ТЗ WP-6 §7 и остатки `npm audit`.

## Угрозы и меры

| Угроза | Мера | Где реализовано |
| --- | --- | --- |
| Брутфорс/перебор учётных данных | Лимит 10 запросов/мин на `/auth/login` и `/auth/register` с одного IP; при превышении `429` с кодом `RATE_LIMITED` | `src/middleware/rate-limiter.js`, `src/routes/auth.routes.js` |
| DoS через частые запросы API | Общий лимит 300 запросов/мин на `/api` | `src/middleware/rate-limiter.js`, `src/app.js` |
| XSS / sniffing / clickjacking / frame-инжекты | `helmet()` (безопасные заголовки, `content-security-policy`) | `src/app.js` |
| Утечка данных в чужие SPA (CORS) | `cors()` только для origins из `CORS_ORIGINS` (дефолт `http://localhost:5173`); чужой Origin не получает `access-control-allow-origin` | `src/config/env.js`, `src/app.js`, `server/.env.example` |
| Слабый/забытый JWT-секрет | `JWT_SECRET` ≥ 32 символов; плейсхолдер из `.env.example` запрещён в `NODE_ENV=production`; при нарушении — `exit 1` без вывода значений секретов | `src/config/env.js` |
| Подмена алгоритма подписи JWT | Явный `HS256` при подписи и проверке (`algorithms: ['HS256']`), срок жизни 24 ч | `src/controllers/auth.controller.js`, `src/middleware/auth.middleware.js` |
| Утечка пароля при компрометации БД | Хеширование `bcryptjs` (cost 10), длина пароля 8–72; `passwordHash` не возвращается ни в одном ответе (select в `getMe`/`updateUser`) | `src/controllers/auth.controller.js`, `src/schemas/auth.schema.js` |
| Раскрытие чувствительных данных в логах | Логгер без зависимостей: только метод, путь без query, статус, длительность, `X-Request-Id`, `userId`, код ошибки; фильтр `[REDACTED]` для `password/token/email/inn/counterpartyInn/counterpartyName/purpose/amount/balanceEndOfDay`; строка импорта — без имени файла; Prisma-ошибки — по `name`/`code` без `meta`/параметров; стек только в `development`; query-лог Prisma выключен | `src/utils/logger.js`, `src/middleware/error.middleware.js`, `src/config/db.js`, `src/controllers/auth.controller.js` |
| Утечка данных контрагентов в ответах API | Сериализаторы операций — `maskName`/`maskInn`; плановые события маскируются при записи; ключ клиента для сценариев — непрозрачный идентификатор, а не ИНН (WP-4) | `src/utils/masking.js`, `src/controllers/operations.controller.js`, `src/controllers/plannedEvents.controller.js` |
| Доступ к чужим ресурсам (IDOR) | Выборка всех `:id`-маршрутов по паре `{ id, userId }`; чужая или несуществующая запись — `404` (включая пустой PATCH) | `src/controllers/operations.controller.js`, `src/controllers/risks.controller.js`, `src/controllers/plannedEvents.controller.js` |
| Загрузка вредоносного/чужого файла | Лимит 25 МБ, не более 1 файла; проверка расширения + содержимого (`.xlsx` — ZIP-сигнатура, `.csv` — без нулевых байтов); несовпадение — `400 VALIDATION` | `src/middleware/upload.middleware.js` |
| Угадывание пользователей по ошибкам входа | Неверный email и неверный пароль — одинаковый `401` с кодом `INVALID_CREDENTIALS` | `src/controllers/auth.controller.js`, `src/middleware/error.middleware.js` |
| Массовые присвоения полей (mass-assignment) | `updateRisk` принимает только контрактные поля; `userId`/связи в патч не пишутся | `src/controllers/risks.controller.js` |

## Уязвимости зависимостей (npm audit --omit=dev)

Проверка на 24.10.2026: **critical — 0** (после удаления неиспользуемого нативного `bcrypt`, за которым тянуло `tar`).

Остаток high-уровня в транзитивных зависимостях без доступного исправления (зафиксировано по ТЗ WP-6 приёмка):

| Пакет | Уязвимость | Обоснование |
| --- | --- | --- |
| `xlsx` (SheetJS, direct) | Prototype Pollution (GHSA-4r6h-8v6p) и ReDoS (GHSA-5pgg-2g8v-p4x9) | Производителем исправление не опубликовано («No fix available»). В прототипе XLSX читается только файл, который загрузил сам пользователь (собственный ввод), доверие к нему есть; альтернативная зависимость не введена (ТЗ: новые зависимости — только перечисленные в пакетах). |
| `zod` < 4.6.6 (direct) | Истощение памяти при валидации сверхбольших коллекций (GHSA-mrhx-c7xc-m3w5) | Исправление только в мажорной версии 4.6.7 — breaking change для валидаторов; на время хакатона заморожено на текущей версии, входные тела API ограничены лимитом загрузки файла (25 МБ) и лимитами запросов. |

## Отклонения от ТЗ

- П. 11 (удаление мёртвых сервисов): удалены мёртвые сервисы, в том числе `support.service.js`; `support.controller.js` работает напрямую через общий `prisma` из `config/db.js` (маршрут `/api/support` жив — см. docs/api-contract.md и `check-contract.mjs`), файл `server/src/services/support.service.js` в репозитории отсутствует.
