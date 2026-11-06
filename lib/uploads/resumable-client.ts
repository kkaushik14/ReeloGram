export class UploadClientError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
export async function uploadRequest(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method = body === undefined ? "GET" : "POST",
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 30000);
  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new UploadClientError(
        typeof data?.error === "string"
          ? data.error
          : response.status === 401
            ? "Sign in again to continue your upload."
            : "The upload service is temporarily unavailable. Your draft is kept on this page.",
        response.status,
      );
    if (!data)
      throw new UploadClientError(
        "We couldn’t confirm the upload response. Please retry.",
      );
    return data;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Upload cancelled", "AbortError");
    if (controller.signal.aborted)
      throw new UploadClientError(
        "Preparing the upload took too long. Your draft is kept; please retry.",
      );
    if (error instanceof UploadClientError) throw error;
    throw new UploadClientError(
      "We couldn’t reach the upload service. Your draft is kept; please retry.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function putPart(
  url: string,
  file: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout>;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      finish(new DOMException("Upload cancelled", "AbortError"));
      xhr.abort();
    };
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish(
          new UploadClientError(
            "This upload stopped making progress. Retry to continue from the saved parts.",
          ),
        );
        xhr.abort();
      }, 90000);
    };
    xhr.open("PUT", url);
    xhr.timeout = 10 * 60000;
    xhr.upload.onprogress = (e) => {
      watch();
      progress(e.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? finish()
        : finish(
            new UploadClientError(
              "A video part could not be saved. Retry to continue the upload.",
              xhr.status,
            ),
          );
    xhr.onerror = () =>
      finish(
        new UploadClientError(
          "The browser could not reach file storage. Retry your upload; saved parts will be kept.",
        ),
      );
    xhr.ontimeout = () =>
      finish(
        new UploadClientError(
          "A file part took too long. Retry to continue your upload.",
        ),
      );
    xhr.onabort = () =>
      finish(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    watch();
    try {
      xhr.send(file);
    } catch {
      finish(new UploadClientError("The browser could not start this upload."));
    }
  });
}
export async function stageFile(
  file: File,
  kind: "video" | "image",
  signal: AbortSignal,
  onId: (id: string) => void,
  onProgress: (value: number) => void,
  existingId?: string,
) {
  const mime =
    kind === "video"
      ? file.type ||
        (/\.webm$/i.test(file.name)
          ? "video/webm"
          : /\.gif$/i.test(file.name)
            ? "image/gif"
            : "video/mp4")
      : file.type;
  const created = existingId
    ? { id: existingId, partBytes: 8 * 1024 * 1024 }
    : await uploadRequest(
        "/api/uploads",
        { kind, size: file.size, mime },
        signal,
      );
  const id = created.id as string;
  onId(id);
  const remote = await uploadRequest(`/api/uploads/${id}`, undefined, signal);
  if (remote.status === "ready") {
    onProgress(100);
    return id;
  }
  if (remote.status !== "uploading")
    throw new UploadClientError(
      "This file was already submitted. Check Your videos.",
    );
  const partBytes = created.partBytes as number;
  const count = Math.ceil(file.size / partBytes);
  const completed = new Set<number>(
    (remote.parts as { part: number; size: number }[])
      .filter(
        (p) =>
          p.size === Math.min(partBytes, file.size - (p.part - 1) * partBytes),
      )
      .map((p) => p.part),
  );
  const sizes = new Map<number, number>();
  for (const part of completed)
    sizes.set(part, Math.min(partBytes, file.size - (part - 1) * partBytes));
  const pending = Array.from({ length: count }, (_, i) => i + 1).filter(
    (p) => !completed.has(p),
  );
  const report = () =>
    onProgress(
      Math.min(
        99,
        Math.floor(
          ([...sizes.values()].reduce((a, b) => a + b, 0) / file.size) * 100,
        ),
      ),
    );
  // At most two parts in flight: bounded memory and useful progress on mobile networks.
  for (let offset = 0; offset < pending.length; offset += 2)
    await Promise.all(
      pending.slice(offset, offset + 2).map(async (part) => {
        for (let attempt = 0; ; attempt++) {
          try {
            const signed = await uploadRequest(
              `/api/uploads/${id}`,
              { action: "sign", parts: [part] },
              signal,
            );
            await putPart(
              signed.parts[0].url,
              file.slice(
                (part - 1) * partBytes,
                Math.min(part * partBytes, file.size),
              ),
              signal,
              (bytes) => {
                sizes.set(part, bytes);
                report();
              },
            );
            break;
          } catch (error) {
            if (
              signal.aborted ||
              attempt >= 2 ||
              (error instanceof UploadClientError &&
                [400, 401, 403, 404, 410, 429].includes(error.status))
            )
              throw error;
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(new DOMException("Upload cancelled", "AbortError"));
              };
              const timer = setTimeout(
                () => {
                  signal.removeEventListener("abort", abort);
                  resolve();
                },
                1000 * 2 ** attempt,
              );
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
          }
        }
      }),
    );
  await uploadRequest(`/api/uploads/${id}`, { action: "complete" }, signal);
  onProgress(100);
  return id;
}
