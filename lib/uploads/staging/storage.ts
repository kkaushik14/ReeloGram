import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { stagingConfig } from "./config.ts";
import { STAGING_POLICY, partSize } from "./policy.ts";

function storage() {
  const config = stagingConfig();
  return {
    client: new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: config,
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
    Bucket: config.bucket,
  };
}
export async function startMultipart(Key: string, ContentType: string) {
  const { client, Bucket } = storage();
  const result = await client.send(
    new CreateMultipartUploadCommand({ Bucket, Key, ContentType }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
  if (!result.UploadId) throw Error("Upload session unavailable");
  return result.UploadId;
}
export async function partUrls(
  Key: string,
  UploadId: string,
  size: number,
  parts: number[],
) {
  const { client, Bucket } = storage();
  return Promise.all(
    parts.map(async (PartNumber) => ({
      part: PartNumber,
      url: await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket,
          Key,
          UploadId,
          PartNumber,
          ContentLength: partSize(size, PartNumber),
        }),
        { expiresIn: STAGING_POLICY.signedUrlSeconds },
      ),
    })),
  );
}
export async function listParts(Key: string, UploadId: string) {
  const { client, Bucket } = storage();
  const data = await client.send(
    new ListPartsCommand({ Bucket, Key, UploadId }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
  if (data.IsTruncated) throw Error("Unexpected part count");
  return data.Parts ?? [];
}
export async function completeMultipart(
  Key: string,
  UploadId: string,
  Parts: { PartNumber?: number; ETag?: string }[],
) {
  const { client, Bucket } = storage();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket,
      Key,
      UploadId,
      MultipartUpload: {
        Parts: Parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
      },
    }),
    { abortSignal: AbortSignal.timeout(15000) },
  );
}
export async function inspectObject(Key: string) {
  const { client, Bucket } = storage();
  const head = await client.send(new HeadObjectCommand({ Bucket, Key }), {
    abortSignal: AbortSignal.timeout(10000),
  });
  const response = await client.send(
    new GetObjectCommand({ Bucket, Key, Range: "bytes=0-15" }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
  return {
    size: head.ContentLength,
    bytes: (await response.Body?.transformToByteArray()) ?? new Uint8Array(),
  };
}
export async function objectUrl(Key: string) {
  const { client, Bucket } = storage();
  return getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), {
    expiresIn: 600,
  });
}
export async function removeObject(Key: string, UploadId?: string) {
  const { client, Bucket } = storage();
  if (UploadId) {
    try {
      await client.send(
        new AbortMultipartUploadCommand({ Bucket, Key, UploadId }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "NoSuchUpload")
        throw error;
    }
  }
  await client.send(new DeleteObjectCommand({ Bucket, Key }), {
    abortSignal: AbortSignal.timeout(10000),
  });
}
