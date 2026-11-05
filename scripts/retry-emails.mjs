import { createRequire } from "node:module";
import mongoose from "mongoose";
import { deliverQueuedEmails } from "../lib/email/outbox.ts";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
);
try {
  await mongoose.connect(process.env.MONGODB_URL, {
    serverSelectionTimeoutMS: 10000,
  });
  await deliverQueuedEmails();
  console.log("Due transactional emails processed.");
} catch (error) {
  console.error("Email retry failed:", error?.name ?? "Service error");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
