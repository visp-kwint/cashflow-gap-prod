// Паттерн Adapter для внешних источников (ТЗ-доп. §5):
// каждый провайдер возвращает массив черновиков PlannedEvent (без userId — проставляет контроллер).
//
// Контракт:
//   sync(ctx: { asOf: Date }) => Array<PlannedEventDraft>
// asOf — опорная дата (utils/asOf.js): устаревшая выписка — последняя операция,
// не настенные часы (ТЗ WP-7 §9). Даты всех мок-событий привязаны к asOf.
//
// Ограничения: только детерминированные генераторы (mock), без реальных API и OAuth.
export class BaseAdapter {
  constructor(code, label) {
    this.code = code;
    this.label = label;
  }
  async sync() {
    throw new Error('adapter.sync() not implemented');
  }
}
