export function stagingConfig() {
  const accountId = process.env.REELOGRAM_R2_ACCOUNT_ID;
  const bucket = process.env.REELOGRAM_R2_BUCKET;
  const accessKeyId = process.env.REELOGRAM_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.REELOGRAM_R2_SECRET_ACCESS_KEY;
  if (
    !accountId ||
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw Error("Private upload storage is not configured");
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}
export function stagingEnabled() {
  return process.env.REELOGRAM_RESUMABLE_UPLOADS === "1";
}
