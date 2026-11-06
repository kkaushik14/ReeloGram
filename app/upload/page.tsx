import UploadForm from "@/app/components/UploadForm";
import ResumableUploadForm from "@/app/components/uploads/ResumableUploadForm";
import { stagingEnabled } from "@/lib/uploads/staging/config";
export default function UploadPage() {
  return stagingEnabled() ? <ResumableUploadForm /> : <UploadForm />;
}
