import AuthEntryPage, { type AuthEntrySearchParams } from "@/app/components/AuthEntryPage";

export default function RegisterPage({ searchParams }: { searchParams: AuthEntrySearchParams }) {
    return <AuthEntryPage register searchParams={searchParams} />;
}
