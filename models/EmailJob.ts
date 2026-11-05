import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
const schema = new Schema(
  {
    _id: { type: String, required: true },
    to: { type: String, required: true },
    subject: String,
    html: String,
    text: String,
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    sentAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ status: 1, nextAttemptAt: 1 });
export default models.EmailJob || model("EmailJob", schema);
