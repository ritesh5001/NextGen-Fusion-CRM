import { Notification } from '../models/Notification.js';
import type { NotificationAttrs } from '../models/Notification.js';

type CreateInput = {
  recipient: string;
  type: NotificationAttrs['type'];
  title: string;
  message?: string;
  link?: string;
  // The workspace this notification belongs to (scopes the recipient's bell).
  workspace?: string;
};

/** Fire-and-forget in-app notification creation. */
export async function notify(input: CreateInput) {
  return Notification.create({
    recipient: input.recipient,
    type: input.type,
    title: input.title,
    message: input.message ?? '',
    link: input.link ?? '',
    workspace: input.workspace,
  });
}
