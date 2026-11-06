import mongoose, { Schema } from "mongoose";

const schema = new Schema(
  {
    _id: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.AdminNonce ||
  mongoose.model("AdminNonce", schema);
