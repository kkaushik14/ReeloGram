import mongoose, { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";

export interface InterFUser {
    email: string;
    password: string;
    _id?: mongoose.Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

const userSchema = new Schema<InterFUser>(
    {
        email: {type: String, required: true, unique: true, trim: true, lowercase: true},
        password: {type: String, required: true},
    },
    {
        timestamps: true
    }
);

// upper wala chalne se pehle preHook chalo, laykin kab: tab jab "passwod" field modified hua hai.
userSchema.pre("save", async function (next) {
    if(this.isModified("password")) {
        this.password = await bcrypt.hash(this.password, 10)
    }
    next();
})

const User = models?.User || model<InterFUser>("User", userSchema)
export default User;
