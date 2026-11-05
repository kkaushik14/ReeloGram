"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Camera, ShieldCheck, Check } from "lucide-react";
import AccountTabs from "./AccountTabs";
import UploaderBadge from "./UploaderBadge";
import { FormSkeleton } from "./LoadingState";
import { AVATAR_MAX_BYTES, type AccountProfile } from "@/lib/account/profile";

export default function ProfileForm() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch("/api/account", {
          cache: "no-store",
          signal,
        });
        if (response.status === 401) {
          router.replace("/login?callbackUrl=/profile");
          return;
        }
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || "We couldn’t load your profile.");
        setProfile(data);
      } catch (error) {
        if (!signal?.aborted)
          setError(
            error instanceof Error ? error.message : "Please try again.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [router],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function select(next?: File) {
    setNotice("");
    setError("");
    if (!next) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
      !next.size ||
      next.size > AVATAR_MAX_BYTES
    ) {
      setError("Choose a JPG, PNG or WebP image up to 2 MB.");
      if (input.current) input.current.value = "";
      return;
    }
    setFile(next);
  }
  async function save(remove = false) {
    if (busy || (!remove && !file)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      if (file) body.set("file", file);
      const response = await fetch("/api/account/avatar", {
        method: remove ? "DELETE" : "POST",
        ...(remove ? {} : { body }),
      });
      const data = await response.json();
      if (response.status === 401) {
        router.replace("/login?callbackUrl=/profile");
        return;
      }
      if (!response.ok)
        throw Error(data.error || "Your photo couldn’t be updated.");
      setFile(null);
      if (input.current) input.current.value = "";
      await load();
      await update();
      router.refresh();
      setNotice(data.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="content account-content">
      <div className="page-heading">
        <div>
          <h1>Your profile.</h1>
          <p>A familiar face for the moments you share.</p>
        </div>
      </div>
      <AccountTabs current="profile" />
      {error && (
        <div className="error-panel" role="alert">
          {error}
          {!profile && !loading && (
            <button
              className="button secondary"
              onClick={() => {
                setLoading(true);
                setError("");
                void load();
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          <Check size={18} />
          {notice}
        </p>
      )}
      {loading ? (
        <FormSkeleton />
      ) : (
        profile && (
          <>
            <section
              className="account-panel profile-photo-panel"
              aria-labelledby="profile-photo-title"
            >
              <div className="profile-photo">
                {preview ? (
                  <img
                    src={preview}
                    width="104"
                    height="104"
                    alt="New profile photo preview"
                  />
                ) : (
                  <UploaderBadge
                    uploader={{
                      id: session?.user.id || "",
                      name: profile.name,
                      image: profile.image || undefined,
                    }}
                  />
                )}
              </div>
              <div className="profile-photo-content">
                <h2 id="profile-photo-title">Your profile photo</h2>
                <p>
                  Choose a photo people will recognise. JPG, PNG or WebP, up to
                  2 MB.
                </p>
                <div className="profile-photo-actions">
                  <label
                    className={`button secondary photo-file ${busy ? "is-busy" : ""}`}
                  >
                    <Camera size={18} />
                    Choose photo
                    <input
                      ref={input}
                      aria-label="Choose a profile photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(event) => select(event.target.files?.[0])}
                    />
                  </label>
                  {file && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      {busy ? "Saving…" : "Save photo"}
                    </button>
                  )}
                  {profile.image && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void save(true)}
                    >
                      Remove photo
                    </button>
                  )}
                </div>
                {file && (
                  <p className="photo-file-name">Selected: {file.name}</p>
                )}
              </div>
            </section>
            <section
              className="account-panel"
              aria-labelledby="account-details-title"
            >
              <div className="account-section-heading">
                <ShieldCheck size={22} />
                <div>
                  <h2 id="account-details-title">Account details</h2>
                  <p>
                    These details are read-only. Your email and date of birth
                    stay private.
                  </p>
                </div>
              </div>
              <div className="account-fields">
                <label>
                  Name
                  <input
                    value={profile.name}
                    readOnly
                    aria-readonly="true"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Email
                  <input
                    value={profile.email}
                    readOnly
                    aria-readonly="true"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Date of birth
                  <input
                    value={profile.dateOfBirth || "Not provided"}
                    readOnly
                    aria-readonly="true"
                    autoComplete="off"
                  />
                </label>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}
