"use client";
import FlashMessage from "./FlashNotification";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { Aperture, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { parseProfile, parseEmail, passwordError } from "@/lib/auth/validation";
import { PASSWORD_POLICY } from "@/lib/auth/password-policy";
import { isUnder13 } from "@/lib/account/age";
import ParentFields from "./ParentFields";
import { useFlash } from "./FlashNotification";
import { completeSignIn } from "@/lib/auth/client";
import { safeAuthDestination } from "@/lib/auth/navigation";
import AuthShowcase from "./AuthShowcase";
import { AuthSkeleton } from "./LoadingState";

type Step = "email" | "login" | "profile" | "password";
export default function AuthForm({ register = false }: { register?: boolean }) {
  const flash = useFlash();
  const { status } = useSession();
  const redirecting = useRef(false);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentManaged, setParentManaged] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const birthdayInput = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const [today, setToday] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.has("registered"))
      setNotice("Your account is ready. Sign in to get started.");
    if (query.has("reset"))
      setNotice("Your password is updated. Sign in with your new password.");
    setToday(new Date().toISOString().slice(0, 10));
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const title =
    step === "profile"
      ? "A little about you"
      : step === "password"
        ? "Make it yours"
        : step === "login"
          ? "Welcome back"
          : register
            ? "Find your place here"
            : "Welcome to ReeloGram";
  const finishSignIn = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    window.location.replace(
      safeAuthDestination(
        new URLSearchParams(location.search).get("callbackUrl"),
        location.origin,
      ),
    );
  }, []);
  useEffect(() => {
    if (status === "authenticated") finishSignIn();
  }, [status, finishSignIn]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || status !== "unauthenticated") return;
    const fields = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      if (step === "email") {
        const response = await fetch("/api/auth/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Please try again.");
        setEmail((value) => value.trim().toLowerCase());
        setStep(data.next === "login" ? "login" : "profile");
        setPassword("");
        setConfirmation("");
      } else if (step === "profile") {
        const profile = parseProfile({
          name: fields.get("name"),
          dateOfBirth: fields.get("dateOfBirth"),
        });
        if (!profile) throw Error("Enter your name and a valid date of birth.");
        if (
          isUnder13(profile.dateOfBirth) &&
          (!parseEmail(fields.get("parentEmail")) ||
            fields.get("parentManaged") !== "on")
        )
          throw Error(
            "Add your parent’s email and confirm that a parent or guardian will manage this account.",
          );
        setName(profile.name);
        setDob(profile.dateOfBirth.toISOString().slice(0, 10));
        setStep("password");
      } else if (step === "password") {
        const problem = passwordError(password, email);
        if (problem) throw Error(problem);
        if (password !== confirmation)
          throw Error("Your passwords don’t match.");
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            name,
            dateOfBirth: dob,
            password,
            ...(isUnder13(dob) ? { parentEmail, parentManaged } : {}),
          }),
        });
        const data = await response.json();
        if (response.status === 409) {
          setStep("login");
          setPassword("");
          setConfirmation("");
          throw Error("An account now uses this email. Sign in to continue.");
        }
        if (!response.ok)
          throw Error(
            data.error || "We couldn’t create your account. Please try again.",
          );
        flash(
          "Your account is ready. Confirm your email before publishing.",
          "success",
        );
        const completed = await completeSignIn(data);
        setPassword("");
        setConfirmation("");
        if (!completed) {
          setStep("login");
          setNotice("Your account is ready. Please sign in to continue.");
          return;
        }
        finishSignIn();
      } else {
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });
        if (!result || result.error)
          throw Error(
            result?.error?.includes("Too many")
              ? result.error
              : result?.error?.includes("temporarily unavailable")
                ? "Sign-in is temporarily unavailable. Please try again later."
                : "Email or password is incorrect. Try again or reset your password.",
          );
        finishSignIn();
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Parent email:"))
        setStep("profile");
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  function back() {
    setError("");
    setNotice("");
    setPassword("");
    setConfirmation("");
    setVisible(false);
    setStep(step === "password" ? "profile" : "email");
  }
  if (status !== "unauthenticated") return <AuthSkeleton />;
  return (
    <div className="auth-scene">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link href="/" className="auth-brand" aria-label="ReeloGram home">
          <Aperture size={27} />
          <span>
            <span className="brand-wordmark">ReeloGram</span>
            <span className="brand-dot">.</span>
          </span>
        </Link>
        {step !== "email" && (
          <button
            className="auth-back"
            type="button"
            disabled={pending}
            onClick={back}
          >
            <ArrowLeft size={15} />
            {step === "password" ? "Back" : "Change email"}
          </button>
        )}
        <h1 ref={heading} tabIndex={-1} id="auth-title">
          {title}
        </h1>
        {step !== "email" && <p className="auth-email">{email}</p>}
        {notice && <FlashMessage message={notice} variant="info" />}
        <form onSubmit={submit} className="form-stack" aria-busy={pending}>
          {step === "email" && (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                maxLength={254}
                disabled={pending}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {step === "profile" && (
            <>
              <label>
                Name
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Your name"
                  required
                  maxLength={80}
                  disabled={pending}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Date of birth
                <input
                  ref={birthdayInput}
                  name="dateOfBirth"
                  aria-label="Date of birth"
                  aria-describedby="birthday-help"
                  type="date"
                  autoComplete="bday"
                  required
                  max={today || undefined}
                  disabled={pending}
                  value={dob}
                  onChange={(event) => setDob(event.target.value)}
                  onInput={(event) => setDob(event.currentTarget.value)}
                />
                <small id="birthday-help">
                  Your date of birth stays private.
                </small>
              </label>
              {isUnder13(dob) && (
                <ParentFields
                  email={parentEmail}
                  accepted={parentManaged}
                  onEmail={setParentEmail}
                  onAccepted={setParentManaged}
                  onEditDateOfBirth={() => {
                    setError("");
                    birthdayInput.current?.focus();
                  }}
                  disabled={pending}
                />
              )}
            </>
          )}
          {(step === "login" || step === "password") && (
            <>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={email}
                readOnly
                hidden
              />
              <label>
                {step === "password" ? "Create password" : "Password"}
                <span className="password-wrap">
                  <input
                    aria-label={
                      step === "password" ? "Create password" : "Password"
                    }
                    name="password"
                    type={visible ? "text" : "password"}
                    autoComplete={
                      step === "password" ? "new-password" : "current-password"
                    }
                    placeholder={
                      step === "password"
                        ? "At least 15 characters"
                        : "Enter your password"
                    }
                    required
                    minLength={
                      step === "password"
                        ? PASSWORD_POLICY.minimumCharacters
                        : undefined
                    }
                    aria-describedby={
                      step === "password" ? "password-help" : undefined
                    }
                    disabled={pending}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={pending}
                    className="icon-button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible((value) => !value)}
                  >
                    {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </span>
                {step === "password" && (
                  <small id="password-help">{PASSWORD_POLICY.help}</small>
                )}
              </label>
              {step === "password" && (
                <label>
                  Confirm password
                  <input
                    name="confirmation"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    disabled={pending}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {error && <FlashMessage message={error} />}
          {step === "login" && (
            <Link className="forgot-link" href="/forgot-password">
              Forgot password?
            </Link>
          )}
          <button type="submit" disabled={pending} className="button primary">
            {pending
              ? "Please wait…"
              : step === "login"
                ? "Sign in"
                : step === "password"
                  ? "Create account"
                  : "Continue"}
            {pending ? (
              <span className="motion-spinner" aria-hidden="true" />
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
        </form>
        {step === "email" && (
          <p className="auth-switch">
            {register ? "Already have an account? " : "New here? "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
        )}
      </section>
      <AuthShowcase />
    </div>
  );
}
