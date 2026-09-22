import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

const importBatchSchema = new Schema(
  {
    fileName: { type: String, required: true },
    uploadedBy: { type: Types.ObjectId, ref: 'User', required: true },
    totalRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    errors: { type: [{ row: Number, message: String }], default: [] },
    workspace: { type: Types.ObjectId, ref: 'Workspace', index: true },
  },
  { timestamps: true }
);

importBatchSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type ImportBatchAttrs = InferSchemaType<typeof importBatchSchema>;
export type ImportBatchDoc = HydratedDocument<ImportBatchAttrs>;

export const ImportBatch = model('ImportBatch', importBatchSchema);
