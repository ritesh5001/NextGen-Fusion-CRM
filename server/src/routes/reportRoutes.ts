import { Router } from 'express';
import * as ctrl from '../controllers/reportController.js';
import { authenticate } from '../middleware/auth.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();
router.use(authenticate, resolveWorkspace, requireWorkspace);

router.get('/overview', requireRole('superadmin'), ctrl.overview);
router.get('/me', ctrl.myStats);

export default router;
