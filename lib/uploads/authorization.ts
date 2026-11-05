import { createHmac } from "node:crypto";
import { Types } from "mongoose";
import { mediaLocation, namedUpload } from "./naming.ts";

export function createUploadAuthorization(
  owner: string,
  kind: "video" | "image",
  publicKey: string,
  privateKey: string,
  options: { name?: string | null; date?: Date } = {},
) {
  const date = options.date ?? new Date();
  const now = Math.floor(date.getTime() / 1000);
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
    ...mediaLocation({
      ownerId: owner,
      name: options.name,
      purpose: kind === "video" ? "video" : "thumbnail",
      date,
      videoId:
        kind === "video" ? new Types.ObjectId().toHexString() : undefined,
    }),
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
  if (
    namedUpload(file.filePath, owner, kind === "video" ? "video" : "thumbnail")
  )
    return true;
  // Keep already-issued V2 grants working. Never accept the old, unowned
  // /videos or /images paths for publishing; existing posts read stored URLs.
  const prefix = `/users/${owner}/${kind}/`;
  return (
    /^[a-f0-9]{24}$/i.test(owner) &&
    typeof file.filePath === "string" &&
    file.filePath.startsWith(prefix) &&
    /^[a-f0-9-]{36}$/.test(file.filePath.slice(prefix.length))
  );
}
