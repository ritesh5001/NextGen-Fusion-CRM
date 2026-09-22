import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { changePasswordSchema, loginSchema } from '../validators/authValidators.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.' },
});

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.get('/me', authenticate, ctrl.me);
router.put('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);
router.post('/logout', authenticate, ctrl.logout);

export default router;
