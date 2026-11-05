import { createRequire } from "node:module";
import mongoose from "mongoose";
import { drainAvatarCleanup } from "../lib/account/avatar-cleanup.ts";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
try {
  await drainAvatarCleanup();
  console.log("Processed due profile photo cleanup jobs.");
} finally {
  await mongoose.disconnect();
}
