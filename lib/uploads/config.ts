export const UPLOAD_POLICY = {
  endpoint: "https://upload.imagekit.io/api/v2/files/upload",
  authTimeoutMs: 15000,
  inactivityMs: 90000,
  processingMs: 120000,
  maximumMs: 30 * 60 * 1000,
} as const;
