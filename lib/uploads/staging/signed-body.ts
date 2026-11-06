/** Unauthenticated callbacks have a strict byte and time budget before signature verification. */
export async function signedBody(request: Request, maximum = 1024) {
  const signature = request.headers.get("upstash-signature");
  if (!signature || signature.length > 4096) throw Error("Invalid callback");
  const reader = request.body?.getReader();
  if (!reader) return { signature, body: "" };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error("Callback timed out")), 5000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.length;
      if (bytes > maximum) throw Error("Callback too large");
      chunks.push(value);
    }
    return {
      signature,
      body: new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      ),
    };
  } finally {
    clearTimeout(timer!);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
