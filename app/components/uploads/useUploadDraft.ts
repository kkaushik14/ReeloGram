"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  initialUploadState,
  uploadReducer,
  savedDraft,
  restoreDraft,
  emptyAsset,
} from "@/lib/uploads/client-state";
import { validateClip } from "@/lib/uploads/clip";
import { validateUpload } from "@/lib/upload-validation";
import { stageFile, uploadRequest } from "@/lib/uploads/resumable-client";

const storageKey = "reelogram-upload-draft-v1";
export function useUploadDraft(owner: string | null | undefined) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState());
  const snapshot = useRef(state);
  snapshot.current = state;
  const controllers = useRef<{
    video?: AbortController;
    image?: AbortController;
  }>({});
  const serial = useRef(0),
    submitting = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Session hydration is not a logout. Do not erase a saved draft while it loads.
    if (owner === undefined) {
      setHydrated(false);
      return;
    }
    controllers.current.video?.abort();
    controllers.current.image?.abort();
    serial.current++;
    submitting.current = false;
    let restored = initialUploadState(owner);
    try {
      if (owner)
        restored = restoreDraft(sessionStorage.getItem(storageKey), owner);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be disabled. */
    }
    dispatch({ type: "restore", state: restored });
    setHydrated(true);
    const active = controllers.current;
    return () => {
      active.video?.abort();
      active.image?.abort();
    };
  }, [owner]);
  useEffect(() => {
    if (!hydrated || !owner || state.owner !== owner) return;
    try {
      sessionStorage.setItem(storageKey, savedDraft(state));
    } catch {
      /* In-memory drafts still work. */
    }
  }, [state, owner, hydrated]);
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (
        [state.video.phase, state.image.phase].some(
          (p) => p === "uploading" || p === "checking",
        ) ||
        state.publishing
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [state]);
  async function select(
    file: File | undefined,
    kind: "video" | "image",
    retry = false,
  ) {
    if (!file || !owner || submitting.current) return;
    const old = snapshot.current[kind];
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    const generation = ++serial.current;
    const current = () =>
      !controller.signal.aborted && controllers.current[kind] === controller;
    const update = (value: Partial<typeof old>) => {
      if (current()) dispatch({ type: "progress", kind, generation, value });
    };
    dispatch({
      type: "asset",
      kind,
      value: {
        ...emptyAsset(generation),
        file,
        name: file.name,
        size: file.size,
        phase: "checking",
        id: retry ? old.id : undefined,
      },
    });
    if (!retry && old.id)
      void uploadRequest(
        `/api/uploads/${old.id}`,
        undefined,
        undefined,
        "DELETE",
      ).catch(() => {});
    try {
      const error =
        kind === "video"
          ? await validateClip(file)
          : validateUpload(file, "image");
      if (error) throw Error(error);
      if (!current()) return;
      update({ phase: "uploading" });
      const id = await stageFile(
        file,
        kind,
        controller.signal,
        (id) => update({ id }),
        (progress) => update({ progress }),
        retry ? old.id : undefined,
      );
      update({ id, phase: "ready", progress: 100, error: undefined });
    } catch (error) {
      if (current()) {
        controller.abort();
        dispatch({
          type: "progress",
          kind,
          generation,
          value: {
            phase: "error",
            error:
              error instanceof Error
                ? error.message
                : "Upload unavailable. Please retry.",
          },
        });
      }
    }
  }
  async function cancel() {
    if (submitting.current || owner === undefined) return;
    const current = snapshot.current;
    controllers.current.video?.abort();
    controllers.current.image?.abort();
    serial.current++;
    dispatch({ type: "reset", owner });
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* no-op */
    }
    await Promise.allSettled(
      [current.video, current.image]
        .filter((a) => a.id)
        .map((a) =>
          uploadRequest(`/api/uploads/${a.id}`, undefined, undefined, "DELETE"),
        ),
    );
  }
  async function publish() {
    if (submitting.current || !owner) return false;
    const current = snapshot.current;
    if (
      current.owner !== owner ||
      current.video.phase !== "ready" ||
      current.image.phase !== "ready"
    ) {
      dispatch({
        type: "error",
        message: "Wait for both files to finish uploading before publishing.",
      });
      return false;
    }
    if (!current.title.trim() || !current.description.trim()) {
      dispatch({
        type: "error",
        message: "Add a title and description before publishing.",
      });
      return false;
    }
    submitting.current = true;
    const requestSerial = serial.current;
    dispatch({ type: "publishing", value: true });
    try {
      const result = await uploadRequest("/api/uploads/jobs", {
        video: current.video.id,
        image: current.image.id,
        title: current.title,
        description: current.description,
      });
      if (requestSerial !== serial.current || snapshot.current.owner !== owner)
        return false;
      if (result.status === "failed")
        throw Error(
          result.error ||
            "This upload could not be published. Please choose your files again.",
        );
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* no-op */
      }
      dispatch({ type: "reset", owner });
      return true;
    } catch (error) {
      if (requestSerial !== serial.current || snapshot.current.owner !== owner)
        return false;
      dispatch({ type: "publishing", value: false });
      dispatch({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Publication could not be confirmed. Your draft is kept; retry safely.",
      });
      return false;
    } finally {
      if (requestSerial === serial.current) submitting.current = false;
    }
  }
  return {
    state,
    hydrated,
    dispatch,
    select,
    cancel,
    publish,
    retry: (kind: "video" | "image") =>
      select(snapshot.current[kind].file ?? undefined, kind, true),
  };
}
