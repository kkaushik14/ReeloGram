import mongoose, { Schema } from "mongoose";
// Receipts are also the immutable business audit. No TTL: old command IDs must
// never become executable again after a retention window or a restore action.
const schema = new Schema(
  {
    _id: { type: String, required: true },
    projectId: { type: String, required: true },
    commandId: { type: String, required: true },
    digest: { type: String, required: true },
    action: { type: String, required: true },
    target: { type: String, required: true },
    actor: { type: String, required: true },
    credentialId: { type: String, required: true },
    reason: { type: String, required: true },
    authorizedAt: { type: Date, required: true },
    expectedRevision: { type: Number, required: true },
    status: { type: String, enum: ["succeeded", "rejected"], required: true },
    code: { type: String, required: true },
    changed: { type: Boolean, required: true },
    before: { type: Boolean },
    after: { type: Boolean },
    revision: { type: Number },
    completedAt: { type: Date, required: true },
  },
  { versionKey: false, strict: "throw" },
);
schema.index({ projectId: 1, completedAt: -1 });
export default mongoose.models.AdminCommand ||
  mongoose.model("AdminCommand", schema);
