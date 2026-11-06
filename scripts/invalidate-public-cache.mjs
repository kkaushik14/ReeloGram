import { createRequire } from "node:module";
import { redisClient } from "../lib/redis/client.ts";
import { withPublicDataMutation } from "../lib/cache/public-data.ts";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const client = redisClient();
if (!client) throw Error("Redis is not configured for this environment");
await withPublicDataMutation(async () => {}, client);
console.log(`Invalidated public cache in ${client.prefix}.`);
