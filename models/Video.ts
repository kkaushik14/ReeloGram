import mongoose, { Schema, model, models } from "mongoose";
import type { VideoSource } from "@/lib/video-sources";

export const VIDEO_DIMENSION = {
  width: 1080,
  height: 1920,
} as const;

export interface InterFVideo {
  hidden?: boolean;
  moderationRevision?: number;
  placement?: "feed" | "hero" | "archived";
  source?: {
    provider: VideoSource;
    id: string;
    url: string;
    creator: string;
    license: string;
  };
  _id?: mongoose.Types.ObjectId;
  fileId?: string;
  thumbnailFileId?: string;
  uploadedBy?: mongoose.Types.ObjectId;
  deletionPending?: boolean;
  title: string;
  description: string;
  videoUrl: string;
  thumbNailUrl: string;
  controls?: boolean;
  transformatioon?: {
    width: number;
    height: number;
    quality?: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const videoSchema = new Schema<InterFVideo>(
  {
    hidden: { type: Boolean, default: false },
    moderationRevision: { type: Number, default: 0, select: false },
    placement: {
      type: String,
      enum: ["feed", "hero", "archived"],
      default: "feed",
    },
    source: {
      type: new Schema(
        {
          provider: {
            type: String,
            enum: ["Pexels", "Pixabay", "Coverr", "Mixkit"],
            required: true,
          },
          id: { type: String, required: true },
          url: { type: String, required: true },
          creator: { type: String, required: true },
          license: { type: String, required: true },
        },
        { _id: false },
      ),
    },
    fileId: { type: String, unique: true, sparse: true },
    thumbnailFileId: { type: String },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deletionPending: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    videoUrl: { type: String, required: true },
    thumbNailUrl: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    controls: { type: Boolean, default: true },
    transformatioon: {
      height: { type: Number, default: VIDEO_DIMENSION.height },
      width: { type: Number, default: VIDEO_DIMENSION.width },
      quality: { type: Number, min: 1, max: 100 },
    },
  },
  {
    timestamps: true,
  },
);

videoSchema.index({ createdAt: -1, _id: -1 });
videoSchema.index({ "source.id": 1 }, { unique: true, sparse: true });
videoSchema.index({ placement: 1, "source.provider": 1 });

const Video = models?.Video || model<InterFVideo>("Video", videoSchema);

export default Video;
