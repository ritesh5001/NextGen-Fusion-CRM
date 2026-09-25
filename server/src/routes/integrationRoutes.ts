import { Router } from 'express';
import * as ctrl from '../controllers/integrationController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import {
  updateTwilioSchema,
  updateTelecmiSchema,
  updateTelnyxSchema,
  telnyxTestSchema,
} from '../validators/integrationValidators.js';

const router = Router();

// Integration settings are superadmin-only.
router.use(authenticate, requireRole('superadmin'));

router.get('/twilio', ctrl.getTwilioIntegration);
router.put('/twilio', validate(updateTwilioSchema), ctrl.updateTwilioIntegration);
router.get('/twilio/numbers', ctrl.listTwilioNumbers);

router.get('/telecmi', ctrl.getTelecmiIntegration);
router.put('/telecmi', validate(updateTelecmiSchema), ctrl.updateTelecmiIntegration);
router.post('/telecmi/detect', ctrl.detectTelecmiRegion);

router.get('/telnyx', ctrl.getTelnyxIntegration);
router.put('/telnyx', validate(updateTelnyxSchema), ctrl.updateTelnyxIntegration);
router.post('/telnyx/connections', validate(telnyxTestSchema), ctrl.listTelnyxConnections);
router.get('/telnyx/numbers', ctrl.listTelnyxNumbers);
router.post('/telnyx/apply-webhook', ctrl.applyTelnyxWebhook);

export default router;
