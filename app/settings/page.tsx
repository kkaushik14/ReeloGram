import AccountGuard from "@/app/components/AccountGuard";
import SettingsForm from "@/app/components/SettingsForm";
export default function SettingsPage() {
  return (
    <AccountGuard path="/settings">
      <SettingsForm />
    </AccountGuard>
  );
}
