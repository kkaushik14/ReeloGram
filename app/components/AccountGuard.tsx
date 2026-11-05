import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-opt";
export default async function AccountGuard({
  children,
  path,
}: {
  children: React.ReactNode;
  path: "/profile" | "/settings";
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    redirect("/login?callbackUrl=" + encodeURIComponent(path));
  return children;
}
