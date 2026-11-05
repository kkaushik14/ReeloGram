"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AuthForm({ register = false }: { register?: boolean }) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending) return;
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "").trim().toLowerCase();
        const password = String(form.get("password") ?? "");
        setPending(true);
        setError(null);
        try {
            if (register) {
                const response = await fetch("/api/auth/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Registration failed.");
                router.push("/login?registered=1");
            } else {
                const result = await signIn("credentials", { email, password, redirect: false });
                if (!result || result.error) throw new Error("Unable to sign in. Check your credentials and try again.");
                const callback = new URLSearchParams(window.location.search).get("callbackUrl");
                const destination = new URL(callback || "/", window.location.origin);
                router.push(destination.origin === window.location.origin ? destination.pathname + destination.search : "/");
                router.refresh();
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : "Please try again.");
        } finally {
            setPending(false);
        }
    }

    return (
        <section className="max-w-sm mx-auto space-y-4">
            <h1 className="text-2xl font-semibold">{register ? "Register" : "Login"}</h1>
            <form onSubmit={submit} className="space-y-4">
                <label className="block">Email
                    <input name="email" type="email" autoComplete="email" required maxLength={254} className="input input-bordered w-full" />
                </label>
                <label className="block">Password
                    <input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} className="input input-bordered w-full" />
                </label>
                {register && <p className="text-sm">Use at least 8 characters, up to 72 UTF-8 bytes.</p>}
                {error && <p role="alert" className="text-error">{error}</p>}
                <button type="submit" disabled={pending} className="btn btn-primary">{pending ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
            </form>
            <Link href={register ? "/login" : "/register"} className="link">{register ? "Already have an account? Sign in" : "Create an account"}</Link>
        </section>
    );
}
