// Детерминированные генераторы синхронизации (ТЗ-доп. §5).
// Даты событий ВСЕГДА привязаны к опорной дате asOf (ctx.asOf: Date), которую
// вычисляет контроллер (utils/asOf.js: устаревшая выписка — последняя операция,
// не настенные часы; ТЗ WP-7 §9). Мок-события не зависят от текущего момента.
import { BaseAdapter } from './adapter.interface.js';

const dayUtc = (y, m, d) => new Date(Date.UTC(y, m, d));

// День месяца от asOf; если день уже прошёл относительно asOf — тот же день следующего месяца
const upcomingDay = (asOf, day) => {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const nm = m + 1 > 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
  return asOf.getUTCDate() < day ? dayUtc(y, m, day) : dayUtc(nm.y, nm.m, day);
};

// Ближайший понедельник от asOf (день-индекс эпохи), если asOf — понедельник, то он сам
function nextMonday(asOf) {
  const dayIdx = Math.floor(asOf.getTime() / 86400000);
  const d = new Date(dayIdx * 86400000);
  const wd = d.getUTCDay(); // 0 = вс
  const add = wd === 1 ? 0 : (8 - wd) % 7 || 7;
  return new Date(d.getTime() + add * 86400000);
}

class OneCAdapter extends BaseAdapter {
  async sync({ asOf }) {
    // 1) 20-е число месяца asOf (если прошло — след.): счёт поставщику 95 000 ₽
    const invoiceDay = upcomingDay(asOf, 20);
    // 2) 22-е число: договор логистики 60 000 ₽
    const contractDay = upcomingDay(asOf, 22);
    const issue = dayUtc(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    return [
      { type: 'invoice', title: 'Счёт №88 за закупку материалов', amount: 95000, direction: 'out',
        expectedDate: invoiceDay, issueDate: issue, deferralDays: 0,
        counterpartyName: 'По***', counterpartyInn: '50******34', counterpartyRisk: 'low', source: '1c',
        status: 'pending', active: true },
      { type: 'contract', title: 'Договор логистики №19', amount: 60000, direction: 'out',
        expectedDate: contractDay, issueDate: issue, deferralDays: 0,
        counterpartyName: 'Тр***', counterpartyInn: '77******08', counterpartyRisk: 'low', source: '1c',
        status: 'pending', active: true },
    ];
  }
}

class EdoAdapter extends BaseAdapter {
  async sync({ asOf }) {
    const y = asOf.getUTCFullYear();
    const m = asOf.getUTCMonth();
    return [
      // 25-е: входящий платёж от «ненадёжного» контрагента — контроллер сам создаст Risk 75%.
      // ДЕМО-ПРАВИЛО (не имитация реестра): риск определяется последними двумя цифрами ИНН
      // (12/99/66 → high, 44/55/77 → medium) — см. COUNTERPARTY_RULES в registry.mock.js
      { type: 'contract', title: 'Оплата по договору №14 (акт подписан в ЭДО)', amount: 250000, direction: 'in',
        expectedDate: dayUtc(y, m, 25), issueDate: dayUtc(y, m, 11), deferralDays: 14,
        counterpartyName: 'Кл***', counterpartyInn: '77******12', counterpartyRisk: 'high', source: 'edo',
        status: 'pending', active: true },
      // 29-е: счёт за партию товара 110 000 ₽
      { type: 'invoice', title: 'Счёт №104 за партию товара', amount: 110000, direction: 'in',
        expectedDate: dayUtc(y, m, 29), issueDate: dayUtc(y, m, 15), deferralDays: 14,
        counterpartyName: 'Сб***', counterpartyInn: '77******02', counterpartyRisk: 'low', source: 'edo',
        status: 'pending', active: true },
    ];
  }
}

// Банк (ТЗ-доп. §5.7): кредиты с графиками, зарплатный проект, созданные, но не исполненные
// платёжные поручения. Детерминированный мок: суммы фиксированы, даты привязаны к месяцу asOf.
class BankAdapter extends BaseAdapter {
  async sync({ asOf }) {
    const a = { y: asOf.getUTCFullYear(), m: asOf.getUTCMonth() };
    const monthN = (n) => {
      const t = a.m + n;
      return { y: a.y + Math.floor(t / 12), m: t % 12 };
    };
    const issue = dayUtc(a.y, a.m, asOf.getUTCDate());
    const base = {
      direction: 'out',
      issueDate: issue, deferralDays: 0,
      counterpartyName: 'БЦ***', counterpartyInn: '77******00', counterpartyRisk: 'low',
      source: 'bank', status: 'pending', active: true,
    };
    // 1) График погашения кредита: 5-е числа трёх месяцев, следующих за месяцем asOf
    const loanPayments = [1, 2, 3].map((i) => {
      const p = monthN(i);
      return { ...base, type: 'contract', title: `Платёж по графику кредита №${i} из 6`, amount: 48000,
        expectedDate: dayUtc(p.y, p.m, 5) };
    });
    return [
      ...loanPayments,
      // 2) Зарплатный проект: 10-е число месяца, следующего за asOf
      { ...base, type: 'contract', title: 'Зарплата сотрудников (зарплатный проект)', amount: 185000,
        expectedDate: dayUtc(monthN(1).y, monthN(1).m, 10) },
      // 3) Созданное, но не исполненное платёжное поручение: 28-е число месяца asOf
      // (если уже прошло относительно asOf — следующего)
      { ...base, type: 'payment', title: 'Платёжное поручение №214 (создано, не исполнено)', amount: 52000,
        expectedDate: upcomingDay(asOf, 28) },
    ];
  }
}

class MarketplaceAdapter extends BaseAdapter {
  async sync({ asOf }) {
    const monday = nextMonday(asOf);
    return [
      { type: 'invoice', title: 'Выплата по еженедельному отчёту о продажах (за вычетом комиссии МП)',
        amount: 84500, direction: 'in', expectedDate: monday,
        issueDate: dayUtc(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
        deferralDays: 0, counterpartyName: 'ВБ***', counterpartyInn: '50******01',
        counterpartyRisk: 'low', source: 'marketplace', status: 'pending', active: true },
    ];
  }
}

export const ADAPTERS = {
  '1c': { adapter: new OneCAdapter('1c', '1С:Бухгалтерия'), label: '1С:Бухгалтерия' },
  edo: { adapter: new EdoAdapter('edo', 'ЭДО (Диадок / СБИС)'), label: 'ЭДО (Диадок / СБИС)' },
  marketplace: { adapter: new MarketplaceAdapter('marketplace', 'Онлайн-кассы и Маркетплейсы'), label: 'Онлайн-кассы и Маркетплейсы (WB / Ozon / ОФД)' },
  bank: { adapter: new BankAdapter('bank', 'Банк'), label: 'Банк (кредиты с графиками, зарплатный проект, платёжные поручения)' },
};

// tax-calendar без мок-адаптера (мёртвый TaxCalendarAdapter удалён): POST /sync идёт через
// syncTaxCalendar контроллера plannedEvents (taxCalendar.service.js), DELETE /sync удаляет
// его pending-события; код остаётся в списке, чтобы unsyncProvider работал.
export const PROVIDER_CODES = ['1c', 'edo', 'tax-calendar', 'marketplace', 'bank'];
