import mongoose, { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";

export interface InterFUser {
  suspended?: boolean;
  moderationRevision?: number;
  publishingRevision?: number;
  name?: string;
  dateOfBirth?: Date;
  sessionVersion?: number;
  signInGrant?: { digest: string; expiresAt: Date };
  passwordReset?: { digest: string; expiresAt: Date };
  image?: string;
  imageFileId?: string;
  emailVerifiedAt?: Date;
  emailConfirmation?: { digest: string; expiresAt: Date; parentEmail?: string };
  parent?: {
    email: string;
    requestedAt: Date;
    verifiedAt?: Date;
    ownerApprovedAt?: Date;
    confirmation?: { digest: string; expiresAt: Date };
  };
  email: string;
  password: string;
  _id?: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<InterFUser>(
  {
    suspended: { type: Boolean, default: false, select: false },
    moderationRevision: { type: Number, default: 0, select: false },
    publishingRevision: { type: Number, default: 0, select: false },
    name: { type: String, trim: true, maxlength: 80 },
    image: { type: String },
    imageFileId: { type: String, select: false },
    dateOfBirth: { type: Date, select: false },
    emailVerifiedAt: { type: Date, select: false },
    emailConfirmation: {
      type: new Schema(
        { digest: String, expiresAt: Date, parentEmail: String },
        { _id: false },
      ),
      select: false,
    },
    parent: {
      type: new Schema(
        {
          email: String,
          requestedAt: Date,
          verifiedAt: Date,
          ownerApprovedAt: Date,
          confirmation: {
            type: new Schema(
              { digest: String, expiresAt: Date },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
      select: false,
    },
    sessionVersion: { type: Number, default: 0 },
    signInGrant: {
      type: new Schema({ digest: String, expiresAt: Date }, { _id: false }),
      select: false,
    },
    passwordReset: {
      type: new Schema({ digest: String, expiresAt: Date }, { _id: false }),
      select: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

// Password writes through save() are always hashed before persistence.
userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

userSchema.index({ "passwordReset.digest": 1 }, { sparse: true });
userSchema.index({ imageFileId: 1 }, { sparse: true });
userSchema.index({ "emailConfirmation.digest": 1 }, { sparse: true });
userSchema.index({ "parent.confirmation.digest": 1 }, { sparse: true });

const User = models?.User || model<InterFUser>("User", userSchema);
export default User;
