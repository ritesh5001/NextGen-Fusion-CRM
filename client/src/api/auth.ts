import { api } from './client';
import type { User } from '@/types';

export async function loginRequest(email: string, password: string) {
  const { data } = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
  return data;
}

export async function fetchMe() {
  const { data } = await api.get<{ user: User }>('/auth/me');
  return data.user;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { data } = await api.put('/auth/change-password', { currentPassword, newPassword });
  return data;
}
