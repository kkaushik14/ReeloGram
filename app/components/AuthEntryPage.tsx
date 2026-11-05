import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-opt";
import { safeAuthDestination } from "@/lib/auth/navigation";
import { appOrigin } from "@/lib/config/app-url";
import AuthForm from "./AuthForm";

export type AuthEntrySearchParams = Promise<{
  callbackUrl?: string | string[];
}>;

export default async function AuthEntryPage({
  register = false,
  searchParams,
}: {
  register?: boolean;
  searchParams: AuthEntrySearchParams;
}) {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    const { callbackUrl } = await searchParams;
    redirect(
      safeAuthDestination(
        typeof callbackUrl === "string" ? callbackUrl : null,
        appOrigin(),
      ),
    );
  }
  return <AuthForm register={register} />;
}
