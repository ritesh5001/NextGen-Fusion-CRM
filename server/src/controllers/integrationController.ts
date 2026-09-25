import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import { TWILIO_KEY, listNumbers } from '../services/twilioService.js';
import { TELECMI_KEY, DEFAULT_SBC_URI, SBC_REGIONS, DEFAULT_API_REGION, API_REGIONS, detectApiRegion } from '../services/telecmiService.js';
import {
  TELNYX_KEY,
  TelnyxApiError,
  webhookUrlFor,
  listCredentialConnections,
  listNumbers as listTelnyxNumbersFromApi,
  applyWebhookToConnection,
} from '../services/telnyxService.js';
import type { UpdateTwilioInput, UpdateTelecmiInput, UpdateTelnyxInput } from '../validators/integrationValidators.js';

// Fields the admin form sends that are kept secret: blanks mean "leave unchanged",
// and we never echo their values back to the client.
const SECRET_FIELDS = ['authToken', 'apiKeySecret'] as const;

/** Client-safe view of the Twilio settings — secrets reduced to a "set" flag. */
function sanitizeTwilio(doc: IntegrationDoc | null) {
  const base = (doc?.publicServerUrl || env.publicUrl || '').replace(/\/$/, '');
  const hasAllCreds = Boolean(
    doc?.accountSid && doc?.apiKeySid && doc?.apiKeySecret && doc?.twimlAppSid && doc?.callerId
  );
  return {
    enabled: doc?.enabled ?? false,
    configured: hasAllCreds,
    accountSid: doc?.accountSid ?? '',
    apiKeySid: doc?.apiKeySid ?? '',
    twimlAppSid: doc?.twimlAppSid ?? '',
    callerId: doc?.callerId ?? '',
    recordCalls: doc?.recordCalls ?? true,
    defaultCountryCode: doc?.defaultCountryCode ?? '',
    publicServerUrl: doc?.publicServerUrl ?? '',
    authTokenSet: Boolean(doc?.authToken),
    apiKeySecretSet: Boolean(doc?.apiKeySecret),
    // Handy for the admin: the URL to paste into the Twilio TwiML App's Voice config.
    voiceWebhookUrl: base ? `${base}/api/v1/calls/voice` : '',
  };
}

// GET /integrations/twilio (superadmin) — current Twilio settings, secrets masked.
export const getTwilioIntegration = asyncHandler(async (_req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TWILIO_KEY });
  res.json({ success: true, data: sanitizeTwilio(doc) });
});

// PUT /integrations/twilio (superadmin) — upsert Twilio settings. Non-secret fields
// always overwrite; secret fields only overwrite when a non-empty value is sent.
export const updateTwilioIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateTwilioInput;
  const doc = (await Integration.findOne({ key: TWILIO_KEY })) ?? new Integration({ key: TWILIO_KEY });

  const plainFields = [
    'enabled',
    'accountSid',
    'apiKeySid',
    'twimlAppSid',
    'callerId',
    'recordCalls',
    'defaultCountryCode',
    'publicServerUrl',
  ] as const;
  for (const field of plainFields) {
    if (body[field] !== undefined) doc.set(field, body[field]);
  }
  // Only replace a secret when a fresh value is supplied (blank = keep current).
  for (const field of SECRET_FIELDS) {
    if (body[field]) doc.set(field, body[field]);
  }

  doc.updatedBy = req.user!.id as unknown as IntegrationDoc['updatedBy'];
  await doc.save();

  res.json({ success: true, data: sanitizeTwilio(doc) });
});

// GET /integrations/twilio/numbers (superadmin) — voice-capable numbers owned by
// the Twilio account, for assigning to telecallers.
export const listTwilioNumbers = asyncHandler(async (_req: Request, res: Response) => {
  const numbers = await listNumbers();
  res.json({ success: true, data: numbers });
});

/** Client-safe view of the TeleCMI settings — the API token reduced to a "set" flag. */
function sanitizeTelecmi(doc: IntegrationDoc | null) {
  const base = (doc?.publicServerUrl || env.publicUrl || '').replace(/\/$/, '');
  return {
    enabled: doc?.enabled ?? false,
    configured: Boolean(doc?.appId && doc?.apiSecret),
    appId: doc?.appId ?? '',
    sbcUri: doc?.sbcUri || DEFAULT_SBC_URI,
    apiRegion: doc?.apiRegion || DEFAULT_API_REGION,
    recordCalls: doc?.recordCalls ?? true,
    defaultCountryCode: doc?.defaultCountryCode ?? '',
    publicServerUrl: doc?.publicServerUrl ?? '',
    apiSecretSet: Boolean(doc?.apiSecret),
    sbcRegions: SBC_REGIONS,
    apiRegions: API_REGIONS,
    // Paste this into the PIOPIY dashboard's "CDR URL" so call records reach us.
    cdrWebhookUrl: base ? `${base}/api/v1/calls/telecmi/cdr` : '',
  };
}

// GET /integrations/telecmi (superadmin) — current TeleCMI settings, secret masked.
export const getTelecmiIntegration = asyncHandler(async (_req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TELECMI_KEY });
  res.json({ success: true, data: sanitizeTelecmi(doc) });
});

// PUT /integrations/telecmi (superadmin) — upsert TeleCMI settings. Non-secret
// fields always overwrite; a blank `apiSecret` keeps the stored one.
export const updateTelecmiIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateTelecmiInput;
  const doc = (await Integration.findOne({ key: TELECMI_KEY })) ?? new Integration({ key: TELECMI_KEY });

  const plainFields = [
    'enabled',
    'appId',
    'sbcUri',
    'apiRegion',
    'recordCalls',
    'defaultCountryCode',
    'publicServerUrl',
  ] as const;
  for (const field of plainFields) {
    if (body[field] !== undefined) doc.set(field, body[field]);
  }
  if (body.apiSecret) doc.set('apiSecret', body.apiSecret);

  doc.updatedBy = req.user!.id as unknown as IntegrationDoc['updatedBy'];
  await doc.save();

  res.json({ success: true, data: sanitizeTelecmi(doc) });
});

// POST /integrations/telecmi/detect (superadmin) — works out which CHUB platform
// the account is on by trying the credentials against both. Uses the values the
// admin has typed, falling back to the stored secret (which is never sent back to
// the browser, so the form field is blank once saved).
export const detectTelecmiRegion = asyncHandler(async (req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TELECMI_KEY });
  const appId = String(req.body.appId || doc?.appId || '').trim();
  const apiSecret = String(req.body.apiSecret || doc?.apiSecret || '').trim();

  if (!appId || !apiSecret) {
    throw ApiError.badRequest('Enter the App ID and API secret first, then test.');
  }

  const { region, tried } = await detectApiRegion(appId, apiSecret);
  res.json({ success: true, region, tried });
});

/** Client-safe view of the Telnyx settings — the API key reduced to a "set" flag. */
function sanitizeTelnyx(doc: IntegrationDoc | null) {
  return {
    enabled: doc?.enabled ?? false,
    configured: Boolean(doc?.apiKey && doc?.connectionId),
    connectionId: doc?.connectionId ?? '',
    publicKey: doc?.publicKey ?? '',
    callerId: doc?.callerId ?? '',
    recordCalls: doc?.recordCalls ?? true,
    defaultCountryCode: doc?.defaultCountryCode ?? '',
    publicServerUrl: doc?.publicServerUrl ?? '',
    apiKeySet: Boolean(doc?.apiKey),
    // Recording and failure reasons depend on signed webhooks reaching us.
    webhookReady: Boolean(doc?.publicKey && webhookUrlFor(doc)),
    webhookUrl: webhookUrlFor(doc),
  };
}

/** Turns a Telnyx API failure into a 4xx the admin panel can show verbatim. */
function asApiError(e: unknown): never {
  if (e instanceof TelnyxApiError) {
    throw e.status >= 500 ? ApiError.serviceUnavailable(e.message) : ApiError.badRequest(e.message);
  }
  throw e;
}

// GET /integrations/telnyx (superadmin) — current Telnyx settings, key masked.
export const getTelnyxIntegration = asyncHandler(async (_req: Request, res: Response) => {
  const doc = await Integration.findOne({ key: TELNYX_KEY });
  res.json({ success: true, data: sanitizeTelnyx(doc) });
});

// PUT /integrations/telnyx (superadmin) — upsert Telnyx settings. A blank `apiKey`
// keeps the stored key. Switching connection invalidates nothing here: each user's
// credential records its connection and is recreated on their next token request.
export const updateTelnyxIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateTelnyxInput;
  const doc = (await Integration.findOne({ key: TELNYX_KEY })) ?? new Integration({ key: TELNYX_KEY });

  const plainFields = [
    'enabled',
    'connectionId',
    'publicKey',
    'callerId',
    'recordCalls',
    'defaultCountryCode',
    'publicServerUrl',
  ] as const;
  for (const field of plainFields) {
    if (body[field] !== undefined) doc.set(field, body[field]);
  }
  if (body.apiKey) doc.set('apiKey', body.apiKey);

  if (doc.enabled && !(doc.apiKey && doc.connectionId)) {
    throw ApiError.badRequest('Add the API key and choose a credential connection before enabling Telnyx.');
  }

  doc.updatedBy = req.user!.id as unknown as IntegrationDoc['updatedBy'];
  await doc.save();

  res.json({ success: true, data: sanitizeTelnyx(doc) });
});

// POST /integrations/telnyx/connections (superadmin) — checks the API key (typed or
// stored) and returns the account's credential connections for the picker.
export const listTelnyxConnections = asyncHandler(async (req: Request, res: Response) => {
  try {
    const connections = await listCredentialConnections(req.body?.apiKey);
    res.json({ success: true, data: connections });
  } catch (e) {
    asApiError(e);
  }
});

// GET /integrations/telnyx/numbers (superadmin) — the account's numbers, for
// assigning a caller ID to each telecaller.
export const listTelnyxNumbers = asyncHandler(async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await listTelnyxNumbersFromApi() });
  } catch (e) {
    asApiError(e);
  }
});

// POST /integrations/telnyx/apply-webhook (superadmin) — sets the connection's
// webhook URL to this server so recordings and hangup reasons reach us.
export const applyTelnyxWebhook = asyncHandler(async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await applyWebhookToConnection()) });
  } catch (e) {
    asApiError(e);
  }
});
