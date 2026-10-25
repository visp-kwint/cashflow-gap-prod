# ТЗ-доработка WP-4: негативные сценарии «что если»

Сценарии применяются **внутри расчётного ядра** (`calculateForecast`, `options.scenarios`), а не
подменой фиктивных операций (legacy-режим песочницы сохранён как `kind: 'custom_event'`).
Базовый прогноз без сценариев и «нулевой» сценарий — побитово один результат.

## Типы, параметры-диапазоны и формулы

| Тип | Параметры | Диапазоны | Формула применения |
|---|---|---|---|
| `client_delay` | `inn`, `days` | days: целое 14–28 (шаг 14; значения 14–28 валидны) | Весь ожидаемый приток от контрагента (регулярные платежи + плановые события + доля нерегулярных поступлений, доля = поступления ИНН за 6 мес. / все поступления за 6 мес.) сдвигается на `days` дней вперёд: из дня `i` убирается `inflow_i(inn)`, в день `i+days` добавляется то же значение (за горизонт — теряется). |
| `revenue_drop` | `percent`, `fromDate?`, `durationDays?` | percent: целое 0–30 (0 = нулевой сценарий); `fromDate` по умолчанию завтра (1-й день горизонта); `durationDays` по умолчанию до конца горизонта | Ожидаемые поступления с `subcategory ∈ {revenue_clients, revenue_acquiring, revenue_marketplace}` в окне `[fromDate, fromDate+durationDays)` умножаются на `(1 − percent/100)`. Влияние на день `i`: `income_i −= revenueIn_i · percent/100`, где `revenueIn_i` = revenue-доля недели (статистика) + регулярные revenue-поступления + плановые revenue-события. |
| `unplanned_expense` | `amount?`, `date?` | amount > 0 (не задан = нулевой сценарий); date — ISO-дата, не раньше завтра от опорной даты | Разовое списание `amount` в день `date`: `expense_date += amount`. |
| `fixed_costs_growth` | `percent`, `fromDate?` | percent: целое 0–50 (0 = нулевой сценарий); `fromDate` по умолчанию завтра | Ожидаемые списания с `subcategory ∈ {rent, suppliers}` с `fromDate` по конец горизонта умножаются на `(1 + percent/100)`: `expense_i += fixedOut_i · percent/100`. |

### Детали применения
- **Базовая линия**: корректировки `adjIncome[i]` / `adjExpense[i]` добавляются к ожидаемым
  поступлениям/списаниям каждого дня перед суммированием `B(d) = B(d−1) + Δ(d)` — отсюда
  `gapDate`, `gapAmount`, `minBalance`, `dangerDays`.
- **Монте-Карло**: те же корректировки `adjIncome/adjExpense` добавляются к ожидаемой части
  каждого дня прогона (стохастический шум bootstrap/нормальное распределение не меняется).
  Отсюда `gapProbabilityPct` и полосы `p10/p90`.
- **Несколько сценариев**: коррекции суммируются (по дням). В одном ответе максимум 4,
  типов — не повторяются (1–4, разные `type`).
- **Атрибуция** (только при действующих сценариях): точка ряда несёт `scenarioAttribution` —
  ожидаемые потоки дня `revenueIn/fixedOut` (до), `scenRevenueIn/scenFixedOut` (после) и
  притоки по контрагентам `inflowsByInn/scenInflowsByInn`.

## API

### `POST /api/scenarios/simulate`
```json
{
  "scenarios": [
    { "type": "client_delay", "params": { "inn": "ИНН-клиента", "days": 21 } },
    { "type": "revenue_drop", "params": { "percent": 20 } }
  ],
  "horizonDays": 30
}
```
Ответ (горизонт и порог — как у главного прогноза `GET /api/dashboard`):
```json
{
  "base": { "series": [{ "date": "", "balance": 0, "p10": 0, "p90": 0 }], "gapDate": null, "gapAmount": 0, "gapProbabilityPct": 0, "minBalance": 0, "dangerDays": [] },
  "scenario": { "...то же, но со всеми выбранными сценариями" },
  "isolated": [{ "...каждый тип отдельно" }],
  "delta": { "gapDateShiftDays": 0, "gapAmount": 0, "gapProbabilityPct": 0, "minBalance": 0 },
  "asOf": "YYYY-MM-DD",
  "scenarios": [ ...отправленные... ]
}
```
Ошибки: `400 VALIDATION` — нарушены границы (5 сценариев, дубликат типа, `percent` вне 0–30 / 0–50,
`days` вне 14–28, `unplanned_expense.date` раньше завтра, неизвестный `type`).

### `GET /api/scenarios/clients`
Топ-5 контрагентов по доле в поступлениях за последние 6 месяцев:
`{ clients: [{ inn, name, totalIn6m, sharePct }], windowMonths: 6 }` — для prefill в `client_delay`.

## Модель (SandboxScenario)
- `kind`: `custom_event` (default, legacy синтетические операции) или тип негативного сценария.
- `params` (String?, JSON): нормализованные параметры сценария.

## UI (страница Песочницы, блок «Негативные сценарии»)
4 карточки, одна на каждый тип:
- `client_delay`: prefill-выпадающий список клиентов (GET /scenarios/clients), `days` 14–28;
- `revenue_drop`: `percent` 0–30 (+ опционально `fromDate`/`durationDays`);
- `unplanned_expense`: `amount` + `date` (не раньше завтра);
- `fixed_costs_growth`: `percent` 0–50.

Кнопка «Расчитать» (POST /scenarios/simulate):
- график двух линий: базовый и выбранные сценарии (p10–p90 полоса, красная зона ниже порога,
  маркер дня разрыва);
- таблица «База / Сценарий / Разница» по `gapDate`, `gapAmount`, `gapProbabilityPct`, `minBalance`;
- вывод-предложение, что сделать, чтобы закрыть разрыв.
