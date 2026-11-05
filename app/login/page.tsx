import AuthEntryPage, { type AuthEntrySearchParams } from "@/app/components/AuthEntryPage";

export default function LoginPage({ searchParams }: { searchParams: AuthEntrySearchParams }) {
    return <AuthEntryPage searchParams={searchParams} />;
}
