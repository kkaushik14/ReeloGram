// Test-only preload. Uses synthetic credentials, a disposable DB, and no provider network.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
const objects = new Map(),
  files = new Map();
const mode = () => {
  try {
    return readFileSync(process.env.REELOGRAM_UPLOAD_FAULT_FILE, "utf8").trim();
  } catch {
    return "";
  }
};
S3Client.prototype.send = async function (command) {
  const { Key, ContentType, MultipartUpload } = command.input;
  const type = command.constructor.name;
  if (type === "CreateMultipartUploadCommand") {
    objects.set(Key, { mime: ContentType });
    return { UploadId: "test-multipart" };
  }
  if (type === "ListPartsCommand") {
    if (objects.get(Key)?.complete) {
      const error = Error("Already completed");
      error.name = "NoSuchUpload";
      throw error;
    }
    return {
      Parts:
        mode() === "missing-parts"
          ? []
          : [
              {
                PartNumber: 1,
                Size: mode() === "wrong-size" ? 31 : 32,
                ETag: '"fixture"',
              },
            ],
    };
  }
  if (type === "CompleteMultipartUploadCommand") {
    objects.set(Key, { ...objects.get(Key), complete: true });
    return { ETag: MultipartUpload.Parts[0].ETag };
  }
  if (type === "HeadObjectCommand") return { ContentLength: 32 };
  if (type === "GetObjectCommand")
    return {
      Body: {
        transformToByteArray: async () =>
          mode() === "bad-signature"
            ? Buffer.from("<script>invalid!")
            : objects.get(Key)?.mime === "image/png"
              ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
              : Buffer.from("xxxxftypisomxxxx"),
      },
    };
  if (type === "DeleteObjectCommand" || type === "AbortMultipartUploadCommand")
    return {};
  throw Error(`Unexpected test S3 operation: ${type}`);
};
const original = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith("https://qstash.upstash.io/")) {
    if (mode() === "queue-down")
      return Response.json(
        { error: "Synthetic queue outage" },
        { status: 503 },
      );
    return Response.json({ messageId: "fixture" });
  }
  if (url.startsWith("https://api.imagekit.io/v1/files?"))
    return Response.json(
      [...files.values()].map((f) => ({
        fileId: f.fileId,
        filePath: f.filePath,
      })),
    );
  if (url === "https://upload.imagekit.io/api/v1/files/upload") {
    if (mode() === "imagekit-down")
      return Response.json({ message: "Synthetic failure" }, { status: 503 });
    if (mode() === "imagekit-rejected")
      return Response.json({ message: "Rejected" }, { status: 415 });
    const folder = options.body.get("folder"),
      name = options.body.get("fileName"),
      path = `${folder}/${name}`;
    const fileId = createHash("sha256").update(path).digest("hex").slice(0, 24);
    const record = {
      fileId,
      filePath: path,
      url: `https://ik.imagekit.io/test${path}`,
      size: 32,
      mime: folder.endsWith("videos") ? "video/mp4" : "image/png",
      isPrivateFile: false,
      width: 720,
      height: 1280,
    };
    files.set(fileId, record);
    if (mode() === "lost-transfer-response")
      throw new TypeError("Synthetic lost response after storage");
    return Response.json(record);
  }
  if (url.startsWith("https://api.imagekit.io/v1/files/")) {
    const id = url.split("/")[5];
    if (options.method === "DELETE") {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    return files.has(id)
      ? Response.json(files.get(id))
      : new Response(null, { status: 404 });
  }
  if (url.startsWith("https://ik.imagekit.io/"))
    return new Response(null, { status: 404 });
  return original(input, options);
};
