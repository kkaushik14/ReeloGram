import Link from "next/link";
export default function AccountTabs({
  current,
}: {
  current: "profile" | "settings";
}) {
  return (
    <nav className="account-tabs" aria-label="Account pages">
      <Link
        href="/profile"
        aria-current={current === "profile" ? "page" : undefined}
      >
        Profile
      </Link>
      <Link
        href="/settings"
        aria-current={current === "settings" ? "page" : undefined}
      >
        Settings
      </Link>
    </nav>
  );
}
