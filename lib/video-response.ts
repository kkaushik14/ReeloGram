import type { InterFVideo } from "@/models/Video";

export function serializeVideo(video: InterFVideo) {
    return {
        id: video._id!.toString(), title: video.title, description: video.description,
        videoUrl: video.videoUrl, thumbnailUrl: video.thumbNailUrl, controls: video.controls,
        transformation: video.transformatioon, uploadedBy: video.uploadedBy?.toString(),
        createdAt: video.createdAt, updatedAt: video.updatedAt,
        source: video.source,
    };
}
