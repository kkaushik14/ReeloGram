import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
const require = createRequire(import.meta.url);
export async function actionServer() {
  const database = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "admin_actions_test" },
    binary: { downloadDir: join(tmpdir(), "reelogram-mongodb-binaries") },
  });
  const faultFile = join(tmpdir(), `reelogram-action-fault-${randomUUID()}`);
  const authSecret = randomBytes(32).toString("hex"),
    readSecret = randomBytes(32).toString("hex"),
    writeSecret = randomBytes(32).toString("hex");
  const config = {
    projectId: "reelogram-test",
    environment: "local",
    owner: "google:test-owner",
    readKey: "read-key",
    writeKey: "write-key",
    authSecret,
    readSecret,
    writeSecret,
  };
  let server,
    exited,
    base,
    logs = "";
  await writeFile(
    ".e2e.tsconfig.json",
    JSON.stringify({ extends: "./tsconfig.json" }),
  );
  await writeFile(faultFile, "network");
  Object.assign(process.env, {
    REELOGRAM_MONGODB_URL: database.getUri(),
    REELOGRAM_REDIS_DISABLED: "1",
  });
  await mongoose.connect(database.getUri());
  const stop = async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    }
  };
  const start = async (overrides = {}, fault = false) => {
    await stop();
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    base = `http://127.0.0.1:${port}`;
    logs = "";
    const production = process.argv.includes("--production");
    server = spawn(
      process.execPath,
      [
        ...(fault
          ? ["--import", "./scripts/testing/admin-action-faults.mjs"]
          : []),
        require.resolve("next/dist/bin/next"),
        production ? "start" : "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env: {
          ...process.env,
          PATH: dirname(process.execPath) + ":" + process.env.PATH,
          VERCEL: "",
          VERCEL_ENV: "",
          REELOGRAM_MONGODB_URL: database.getUri(),
          REELOGRAM_REDIS_DISABLED: "1",
          REELOGRAM_AUTH_TRUST_PROXY: "0",
          REELOGRAM_NEXTAUTH_SECRET: authSecret,
          REELOGRAM_APP_URL: base,
          REELOGRAM_NEXTAUTH_URL: base,
          REELOGRAM_ADMIN_ENABLED: "1",
          REELOGRAM_ADMIN_PROJECT_ID: config.projectId,
          REELOGRAM_ADMIN_ENVIRONMENT: "local",
          REELOGRAM_ADMIN_AUDIENCE: base,
          REELOGRAM_ADMIN_KEY_ID: config.readKey,
          REELOGRAM_ADMIN_SECRET: readSecret,
          REELOGRAM_ADMIN_PREVIOUS_KEY_ID: "",
          REELOGRAM_ADMIN_PREVIOUS_SECRET: "",
          REELOGRAM_ADMIN_PREVIOUS_VALID_UNTIL: "",
          REELOGRAM_ADMIN_ACTIONS_ENABLED: "1",
          REELOGRAM_ADMIN_WRITE_KEY_ID: config.writeKey,
          REELOGRAM_ADMIN_WRITE_SECRET: writeSecret,
          REELOGRAM_ADMIN_OWNER_ID: config.owner,
          REELOGRAM_ADMIN_ACTIONS:
            "accounts.suspend,accounts.restore,videos.hide,videos.restore",
          REELOGRAM_TEST_REDIS_FAULT_FILE: faultFile,
          REELOGRAM_E2E_DIST_DIR: production ? "" : ".next-admin",
          ...overrides,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    exited = once(server, "exit");
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (c) => {
        logs = (logs + c).slice(-12000);
      });
    for (let i = 0; i < 90; i++) {
      try {
        if (
          (
            await fetch(base + "/api/auth/session", {
              signal: AbortSignal.timeout(1500),
            })
          ).ok
        )
          return;
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    throw Error("Isolated action server failed to start");
  };
  return {
    config,
    database,
    get base() {
      return base;
    },
    get logs() {
      return logs;
    },
    db: mongoose.connection.db,
    start,
    stop,
    fault: (mode) => writeFile(faultFile, mode),
    close: async () => {
      await stop();
      await mongoose.disconnect();
      await database.stop();
      await rm(faultFile, { force: true });
      await rm(".e2e.tsconfig.json", { force: true });
    },
  };
}
