import { createHmac, randomUUID } from "node:crypto";

export function createUploadAuthorization(
  owner: string,
  kind: "video" | "image",
  publicKey: string,
  privateKey: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (!/^[a-f0-9]{24}$/i.test(owner)) throw Error("Invalid upload owner");
  const types =
    kind === "image"
      ? ["image/jpeg", "image/png", "image/webp"]
      : [
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "video/x-msvideo",
          "video/avi",
          "video/vnd.avi",
          "image/gif",
        ];
  const params = {
    fileName: randomUUID(),
    folder: `/users/${owner}/${kind}`,
    useUniqueFileName: "false",
    overwriteFile: "false",
    isPrivateFile: "false",
    checks: `"file.size" > 0 AND "file.size" <= ${(kind === "image" ? 5 : 100) * 1024 * 1024} AND "file.mime" IN ${JSON.stringify(types)}`,
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "HS256", typ: "JWT", kid: publicKey })}.${encode({ ...params, iat: now, exp: now + 1800 })}`;
  return {
    token: `${input}.${createHmac("sha256", privateKey).update(input).digest("base64url")}`,
    params,
  };
}

/** Only ImageKit's authenticated file-details response can establish ownership. */
export function ownsUpload(
  file: { filePath?: string },
  owner: string,
  kind: "video" | "image",
) {
  const prefix = `/users/${owner}/${kind}/`;
  return (
    /^[a-f0-9]{24}$/i.test(owner) &&
    typeof file.filePath === "string" &&
    file.filePath.startsWith(prefix) &&
    /^[a-f0-9-]{36}$/.test(file.filePath.slice(prefix.length))
  );
}
