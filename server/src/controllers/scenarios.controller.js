// server/src/controllers/scenarios.controller.js
// ТЗ-доработка WP-4: негативные сценарии «что если».
import { scenarioService } from '../services/scenario.service.js';
import { ApiError } from '../utils/errors.js';

export class ScenariosController {
  /** POST /scenarios/simulate — бейз/сценарий/изолированные/дельта по выбранным негативным сценариям. */
  async simulate(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();
      const result = await scenarioService.simulate(userId, req.body || {});
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /scenarios/clients — топ-5 клиентов по доле в поступлениях за 6 месяцев (prefill для client_delay). */
  async clients(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();
      const result = await scenarioService.clients(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /** GET /scenarios/defaults — дефолт unplanned_expense из истории (медиана unplanned_*). */
  async defaults(req, res, next) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw ApiError.unauthorized();
      const result = await scenarioService.suggestUnplannedDefault(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const scenariosController = new ScenariosController();
