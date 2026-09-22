import dotenv from 'dotenv';

dotenv.config();

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 5050),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/crm_nextgenfusion'),
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  // Public URL of this service, used by the keep-alive self-ping. Render injects
  // RENDER_EXTERNAL_URL automatically; SELF_URL can override it.
  selfUrl: process.env.SELF_URL ?? process.env.RENDER_EXTERNAL_URL,
  // Fallback public base URL Twilio uses to reach our webhooks when the admin
  // panel's "Public server URL" is left blank. (Render injects RENDER_EXTERNAL_URL.)
  publicUrl: process.env.PUBLIC_SERVER_URL ?? process.env.SELF_URL ?? process.env.RENDER_EXTERNAL_URL,
  superadmin: {
    name: process.env.SUPERADMIN_NAME ?? 'Super Admin',
    email: process.env.SUPERADMIN_EMAIL ?? 'admin@nextgenfusion.in',
    password: process.env.SUPERADMIN_PASSWORD ?? 'Admin@12345',
  },
};
