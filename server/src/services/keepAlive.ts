import { env } from '../config/env.js';

/**
 * Render's free tier spins a web service down after ~15 minutes without inbound
 * HTTP traffic, which adds a cold-start delay (~30–60s) to the next request.
 *
 * This pings the service's own public health endpoint on an interval so there is
 * always recent inbound traffic, keeping the instance warm. It only runs when a
 * public URL is known (Render injects `RENDER_EXTERNAL_URL`; `SELF_URL` can
 * override it locally) so it is a no-op in development.
 */

const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (Render sleeps after ~15)

export function startKeepAlive(): void {
  const base = env.selfUrl?.replace(/\/+$/, '');
  if (!base) {
    console.log('⏸️  Keep-alive disabled (no SELF_URL / RENDER_EXTERNAL_URL set)');
    return;
  }

  const url = `${base}/api/v1/health`;

  const ping = async () => {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        console.warn(`Keep-alive ping returned ${res.status} for ${url}`);
      }
    } catch (err) {
      console.warn('Keep-alive ping failed:', (err as Error).message);
    }
  };

  // `unref()` so the timer never keeps the process alive on its own.
  const timer = setInterval(ping, PING_INTERVAL_MS);
  timer.unref?.();

  console.log(`💓 Keep-alive enabled — pinging ${url} every 10 min`);
}
