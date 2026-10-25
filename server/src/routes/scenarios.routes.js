// server/src/routes/scenarios.routes.js
// ТЗ-доработка WP-4: негативные сценарии «что если»
import { Router } from 'express';
import { scenariosController } from '../controllers/scenarios.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.post('/simulate', scenariosController.simulate);
router.get('/clients', scenariosController.clients);
router.get('/defaults', scenariosController.defaults); // отчёт §8.4: дефолт unplanned_expense из истории

export default router;
