import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import leadRoutes from './leadRoutes.js';
import taskRoutes from './taskRoutes.js';
import callRoutes from './callRoutes.js';
import followUpRoutes from './followUpRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import reportRoutes from './reportRoutes.js';
import integrationRoutes from './integrationRoutes.js';
import workspaceRoutes from './workspaceRoutes.js';

const router = Router();

// Stamped once at boot so /health can prove *which* build is live — a stale deploy
// otherwise looks identical to a fresh one and shows up only as odd 400s.
const STARTED_AT = new Date().toISOString();
const COMMIT = (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? '').slice(0, 7);

router.get('/health', (_req, res) =>
  res.json({ success: true, status: 'ok', commit: COMMIT || 'unknown', startedAt: STARTED_AT })
);
router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/users', userRoutes);
router.use('/leads', leadRoutes);
router.use('/tasks', taskRoutes);
router.use('/calls', callRoutes);
router.use('/followups', followUpRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/integrations', integrationRoutes);

export default router;
