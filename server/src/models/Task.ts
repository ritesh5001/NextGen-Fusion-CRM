import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const TASK_TYPES = ['call', 'follow_up', 'custom'] as const;
export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

const taskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    type: { type: String, enum: TASK_TYPES, default: 'custom' },
    relatedLead: { type: Schema.Types.ObjectId, ref: 'Lead' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * When this task was handed to its current assignee — set on create and
     * re-stamped on reassignment, so it answers "how long has this been sitting
     * with them?" rather than "when did the task first exist?" (that's
     * `createdAt`). Tasks that predate the field fall back to `createdAt` in the
     * UI, so no backfill is needed.
     */
    assignedAt: { type: Date, default: Date.now },
    dueDate: { type: Date },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    status: { type: String, enum: TASK_STATUSES, default: 'pending', index: true },
    // Stamped the first time the task moves to in_progress.
    startedAt: { type: Date },
    /**
     * When the work was actually done. The telecaller sets this themselves when
     * completing (defaulting to now), so a task finished this morning but ticked
     * off this evening still reports the real time.
     */
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completionNote: { type: String, default: '' },
    /** Optional self-reported effort, in minutes. */
    timeSpentMin: { type: Number, min: 0 },
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true }
);

// Workspace-first compound indexes for the scoped task list/filter queries.
taskSchema.index({ workspace: 1, assignedTo: 1, status: 1 });
taskSchema.index({ workspace: 1, dueDate: 1 });
taskSchema.index({ workspace: 1, status: 1, dueDate: 1 });

taskSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type TaskAttrs = InferSchemaType<typeof taskSchema>;
export type TaskDoc = HydratedDocument<TaskAttrs>;

export const Task = model('Task', taskSchema);
