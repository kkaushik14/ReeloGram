"use client";

import { useState, useEffect, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Aperture, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";

import Headline from "./motion/Headline";
export default function AuthForm({ register = false }: { register?: boolean }) {
    const router = useRouter();
    const [visible, setVisible] = useState(false);
    const [registered, setRegistered] = useState(false);
    useEffect(() => { setRegistered(new URLSearchParams(window.location.search).has("registered")); }, []);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending) return;
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "").trim().toLowerCase();
        const password = String(form.get("password") ?? "");
        if (register && new TextEncoder().encode(password).length > 72) { setError("That password is too long. Please choose a shorter one."); return; }
        setPending(true);
        setError(null);
        try {
            if (register) {
                const response = await fetch("/api/auth/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                if (!response.ok) throw new Error(response.status === 409 ? "An account with this email already exists. Please sign in." : response.status === 400 ? "Check your email and choose a password with at least 8 characters." : "We couldn’t create your account. Please try again.");
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

    return <div className="content"><div className="auth-layout"><aside className="auth-story"><div><Aperture size={35}/><h2>Every story starts<br/>with a point of view.</h2><p>A place to share what catches your eye.<br/>And discover what catches someone else’s.</p></div><span>ReeloGram / Stories in motion</span></aside><section className="auth-form"><Headline text={register ? "Make yourself at home." : "Good to see you again."}/><p className="auth-intro">{register ? "Create your account and share your first story." : "Sign in to pick up where you left off."}</p>{registered && <p className="notice" role="status">Your account is ready. Sign in to get started.</p>}<form onSubmit={submit} className="form-stack"><label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} disabled={pending}/></label><label>Password<span className="password-wrap"><input aria-label="Password" name="password" type={visible ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} disabled={pending}/><button type="button" className="icon-button" aria-label={visible ? "Hide password" : "Show password"} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></span></label>{register && <small>Use at least 8 characters. Longer passwords are more secure.</small>}{error && <p role="alert" className="error-text">{error}</p>}<button type="submit" disabled={pending} className="button primary">{pending ? "Please wait…" : register ? "Create account" : "Sign in"}{pending?<span className="motion-spinner" aria-hidden="true"/>:<ArrowRight size={16}/>}</button></form><p className="auth-switch">{register ? "Already have an account? " : "New around here? "}<Link href={register ? "/login" : "/register"}>{register ? "Sign in" : "Create an account"}</Link></p></section></div></div>;
}
