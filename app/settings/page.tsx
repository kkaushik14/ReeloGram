import AccountGuard from "@/app/components/AccountGuard";
import SettingsForm from "@/app/components/SettingsForm";
import packageInfo from "@/package.json";
export default function SettingsPage() {
  return (
    <AccountGuard path="/settings">
      <SettingsForm version={packageInfo.version} />
    </AccountGuard>
  );
}
