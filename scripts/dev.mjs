import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Explicit port makes Next fail clearly when occupied instead of silently moving.
// Process-only overrides keep local auth/email links off the production domain.
const origin = "http://localhost:3000";
const available = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(3000, "localhost", () => probe.close(() => resolve(true)));
});
if (!available) {
  console.error(
    "Cannot start ReeloGram: localhost:3000 is already in use or unavailable. Stop the existing project server and retry.",
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--turbopack",
    "--hostname",
    "localhost",
    "--port",
    "3000",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      REELOGRAM_NEXTAUTH_URL: origin,
      REELOGRAM_NEXTAUTH_URL_INTERNAL: origin,
      REELOGRAM_APP_URL: origin,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", () => {
  console.error("Unable to start the local development server.");
  process.exitCode = 1;
});
