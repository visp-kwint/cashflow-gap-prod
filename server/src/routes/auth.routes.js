// server/src/routes/auth.routes.js
import { Router } from 'express';
import { register, login, getMe, updateUser } from '../controllers/auth.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { upload, validateFileContent } from '../middleware/upload.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { authRateLimiter } from '../middleware/rate-limiter.js';
import { registerSchema, loginSchema } from '../schemas/auth.schema.js';

const router = Router();

// authRateLimiter: не более 10 запросов в минуту с одного IP (WP-6 §3).
router.post('/register', authRateLimiter, upload.single('file'), validateFileContent, validate(registerSchema), register);
router.post('/login', authRateLimiter, validate(loginSchema), login);
router.get('/me', authMiddleware, getMe);
router.patch('/user', authMiddleware, updateUser);

export default router;