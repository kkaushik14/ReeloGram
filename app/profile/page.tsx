import AccountGuard from "@/app/components/AccountGuard";
import ProfileForm from "@/app/components/ProfileForm";
export default function ProfilePage() {
  return (
    <AccountGuard path="/profile">
      <ProfileForm />
    </AccountGuard>
  );
}
