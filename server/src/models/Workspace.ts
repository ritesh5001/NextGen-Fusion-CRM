import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

// A tenant boundary. Every telecaller belongs to exactly one workspace, and all
// CRM data (contacts, tasks, calls, follow-ups, notifications, imports) is scoped
// to a workspace. The superadmin is global (workspace-less) and switches between
// workspaces via the `X-Workspace-Id` request header (see middleware/workspace.ts).
const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

workspaceSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type WorkspaceAttrs = InferSchemaType<typeof workspaceSchema>;
export type WorkspaceDoc = HydratedDocument<WorkspaceAttrs>;

export const Workspace = model('Workspace', workspaceSchema);
