import { Router } from 'express';
import * as ctrl from '../controllers/aiCallController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { resolveWorkspace, requireWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import {
  createCampaignSchema,
  campaignActionSchema,
  listAiCallsQuerySchema,
  setInterestSchema,
} from '../validators/aiCallValidators.js';

const router = Router();

// Public: Bolna's execution webhook (authenticated by the URL's secret token).
router.post('/webhook', ctrl.bolnaWebhook);

// Everything else is the superadmin's campaign console, scoped to the workspace.
router.use(authenticate, requireRole('superadmin'), resolveWorkspace, requireWorkspace);

router.get('/campaigns', ctrl.listCampaigns);
router.post('/campaigns', validate(createCampaignSchema), ctrl.createCampaign);
router.get('/campaigns/:id', ctrl.getCampaign);
router.patch('/campaigns/:id/status', validate(campaignActionSchema), ctrl.campaignAction);
router.delete('/campaigns/:id', ctrl.deleteCampaign);

router.get('/calls', validate(listAiCallsQuerySchema, 'query'), ctrl.listCalls);
router.patch('/calls/:id/interest', validate(setInterestSchema), ctrl.setInterest);
router.post('/calls/:id/retry', ctrl.retryCall);

export default router;
