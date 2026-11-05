import { UPLOAD_POLICY } from "./config.ts";

/** Direct-to-ImageKit upload; private credentials and large file bodies never pass through Vercel. */
export async function uploadToImageKit(
  file: File,
  kind: "video" | "image",
  publicKey: string,
  onProgress: (percent: number) => void,
) {
  if (!publicKey) throw new Error("Uploads are temporarily unavailable. Please try again later.");
  const response = await fetch("/api/imagekit-auth", {
    cache: "no-store",
    signal: AbortSignal.timeout(UPLOAD_POLICY.authTimeoutMs),
  });
  if (!response.ok)
    throw new Error(response.status === 401
      ? "Please sign in again before uploading."
      : "Uploads are temporarily unavailable. Please try again later.");
  const auth = await response.json();
  if (typeof auth.signature !== "string" || typeof auth.token !== "string" ||
    !Number.isFinite(Number(auth.expire)) || Number(auth.expire) <= Date.now() / 1000)
    throw new Error("We couldn’t start a secure upload. Please try again.");
  const data = new FormData();
  data.set("file", file);
  data.set("fileName", file.name);
  data.set("folder", kind === "video" ? "/videos" : "/images");
  data.set("publicKey", publicKey);
  for (const key of ["signature", "token", "expire"])
    data.set(key, String(auth[key]));

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (error?: Error, fileId?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(fileId!);
    };
    const watchProgress = (milliseconds: number) => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish(new Error("The upload stopped making progress. Your form is saved on this page; please try again."));
        xhr.abort();
      }, milliseconds);
    };
    xhr.open("POST", UPLOAD_POLICY.endpoint);
    // A steady large upload may take longer than two minutes. Only stalled uploads
    // should time out quickly; retain an overall ceiling for abandoned transfers.
    xhr.timeout = UPLOAD_POLICY.maximumMs;
    xhr.upload.onprogress = (event) => {
      watchProgress(UPLOAD_POLICY.inactivityMs);
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => watchProgress(UPLOAD_POLICY.processingMs);
    xhr.onerror = () => finish(new Error("We couldn’t reach the upload service. Check your connection and try again."));
    xhr.ontimeout = () => finish(new Error("The upload took too long. Please try again with a smaller video or a faster connection."));
    xhr.onabort = () => finish(new Error("The upload was stopped. Your form is kept so you can try again."));
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && typeof result.fileId === "string" && result.fileId) {
          onProgress(100);
          finish(undefined, result.fileId);
        } else {
          finish(new Error(xhr.status === 413
            ? "The upload service couldn’t accept this file size. Please choose a smaller file."
            : "The upload service couldn’t accept this file. Please try again."));
        }
      } catch {
        finish(new Error("We couldn’t confirm this upload. Please try again."));
      }
    };
    watchProgress(UPLOAD_POLICY.inactivityMs);
    try {
      xhr.send(data);
    } catch {
      finish(new Error("We couldn’t start the upload. Please try again."));
    }
  });
}
