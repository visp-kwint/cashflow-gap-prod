import { calendarService } from '../services/calendar.service.js';
import { ApiError } from '../utils/errors.js';

export class CalendarController {
  /**
   * GET /calendar/events?month=YYYY-MM
   * Возвращает массив событий месяца в форме CalendarDay контракта:
   * { date, status: 'danger'|'good'|'neutral', expectedIncome, expectedExpense, expectedBalance, reasons[] }.
   */
  async events(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();

      const events = await calendarService.getEvents(userId, req.query.month);
      res.json(events);
    } catch (err) {
      next(err);
    }
  }
}

export const calendarController = new CalendarController();
