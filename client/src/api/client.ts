import axios from 'axios';
import { useAuthStore } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';

// Resolves the API base URL. In local dev VITE_API_URL is unset and requests
// go through the Vite proxy at `/api/v1`. In production set VITE_API_URL to the
// deployed API — either the origin (https://api.example.com) or the full path
// (https://api.example.com/api/v1); the `/api/v1` suffix is added if missing.
function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();
  if (!raw) return '/api/v1';
  const base = raw.replace(/\/+$/, '');
  return /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`;
}

export const api = axios.create({
  baseURL: resolveBaseUrl(),
});

// Attach JWT + the selected workspace to every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  if (workspaceId) config.headers['X-Workspace-Id'] = workspaceId;
  return config;
});

// On 401, log the user out.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

interface ApiErrorBody {
  message?: string;
  /** Zod issues from the `validate` middleware: which field failed and why. */
  details?: { path?: string; message?: string }[] | unknown;
}

/**
 * Extracts a human-readable message from an axios error.
 *
 * The server sends validation failures as `{ message: 'Validation failed', details: [...] }`;
 * without the details the toast just says "Validation failed", which tells nobody anything —
 * so the offending fields are appended.
 */
export function apiError(err: unknown): string {
  if (!axios.isAxiosError(err)) return 'Something went wrong';

  const body = err.response?.data as ApiErrorBody | undefined;
  const message = body?.message ?? err.message;

  if (Array.isArray(body?.details)) {
    const fields = (body.details as { path?: string; message?: string }[])
      .map((d) => [d?.path, d?.message].filter(Boolean).join(': '))
      .filter(Boolean);
    if (fields.length) return `${message} — ${fields.join('; ')}`;
  }
  return message;
}
