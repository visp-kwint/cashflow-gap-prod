import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { loadDemo, listDemo } from '../controllers/demo.controller.js';

const router = Router();

// ТЗ-доработка WP-7 §13: демо-выписки из test-data/demo/
router.get('/companies', authMiddleware, listDemo);
router.post('/', authMiddleware, loadDemo);

export default router;
