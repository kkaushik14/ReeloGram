import mongoose, { Schema, model, models } from "mongoose";

export const VIDEO_DIMENSION = {
    width: 1080,
    height: 1920
} as const

export interface InterFVideo {
    _id?: mongoose.Types.ObjectId;
    fileId?: string;
    thumbnailFileId?: string;
    uploadedBy?: mongoose.Types.ObjectId;
    title: string;
    description: string;
    videoUrl: string;
    thumbNailUrl: string;
    controls?: boolean;
    transformatioon?: {
        width: number;
        height: number;
        quality?: number
    }
    createdAt?: Date;
    updatedAt?: Date;
}

const videoSchema = new Schema<InterFVideo>({
    fileId: {type: String, unique: true, sparse: true},
    thumbnailFileId: {type: String},
    uploadedBy: {type: Schema.Types.ObjectId, ref: "User"},
    title: {type: String, required: true, trim: true, maxlength: 120},
    videoUrl: {type: String, required: true},
    thumbNailUrl: {type: String, required: true},
    description: {type: String, required: true, trim: true, maxlength: 2000},
    controls: {type: Boolean, default: true},
    transformatioon: {
        height: {type: Number, default: VIDEO_DIMENSION.height},
        width: {type: Number, default: VIDEO_DIMENSION.width},
        quality: {type: Number, min: 1, max: 100}
    }
}, {
    timestamps: true
});

videoSchema.index({ createdAt: -1, _id: -1 });

const Video = models?.Video || model<InterFVideo>("Video", videoSchema)

export default Video;
