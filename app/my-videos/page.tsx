import VideoFeed from "@/app/components/VideoFeed";
import UploadJobs from "@/app/components/uploads/UploadJobs";
import { stagingEnabled } from "@/lib/uploads/staging/config";
export default function MyVideos() {
  return (
    <VideoFeed
      mine
      uploadActivity={stagingEnabled() ? <UploadJobs /> : undefined}
    />
  );
}
