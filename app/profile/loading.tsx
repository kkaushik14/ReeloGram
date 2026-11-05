import { FormSkeleton } from "@/app/components/LoadingState";
export default function Loading() {
  return (
    <div
      className="content account-content"
      role="status"
      aria-label="Loading your profile"
    >
      <FormSkeleton />
    </div>
  );
}
