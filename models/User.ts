import mongoose, { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";

export interface InterFUser {
  name?: string;
  dateOfBirth?: Date;
  sessionVersion?: number;
  signInGrant?: { digest: string; expiresAt: Date };
  passwordReset?: { digest: string; expiresAt: Date };
  image?: string;
  imageFileId?: string;
  email: string;
  password: string;
  _id?: mongoose.Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<InterFUser>(
  {
    name: { type: String, trim: true, maxlength: 80 },
    image: { type: String },
    imageFileId: { type: String, select: false },
    dateOfBirth: { type: Date, select: false },
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
userSchema.index({imageFileId:1},{sparse:true});

const User = models?.User || model<InterFUser>("User", userSchema);
export default User;
