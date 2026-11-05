import { createServer } from "node:tls";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
/** Real TLS SMTP sink, used only by the disposable E2E child app. Never sends internet mail. */
export async function startEmailTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "reelogram-mail-"));
  const key = join(directory, "key.pem"),
    cert = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const messages = [];
  let failures = 0;
  const sockets = new Set();
  const server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.write("220 localhost ESMTP ready\r\n");
      let buffer = "",
        data = false,
        lines = [],
        recipient = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\r\n")) {
          const end = buffer.indexOf("\r\n"),
            line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === ".") {
              if (failures > 0) {
                failures--;
                lines = [];
                data = false;
                socket.write("550 test delivery rejected\r\n");
                continue;
              }
              messages.push({ to: recipient, raw: lines.join("\r\n") });
              lines = [];
              data = false;
              socket.write("250 queued\r\n");
            } else lines.push(line);
            continue;
          }
          if (/^EHLO|^HELO/i.test(line))
            socket.write(
              "250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1000000\r\n",
            );
          else if (/^AUTH PLAIN/i.test(line))
            socket.write("235 authenticated\r\n");
          else if (/^RCPT TO:/i.test(line)) {
            recipient = line.slice(8).trim().replace(/[<>]/g, "");
            socket.write("250 accepted\r\n");
          } else if (/^MAIL FROM:|^RSET|^NOOP/i.test(line))
            socket.write("250 accepted\r\n");
          else if (/^DATA$/i.test(line)) {
            data = true;
            socket.write("354 send message\r\n");
          } else if (/^QUIT$/i.test(line)) {
            socket.end("221 bye\r\n");
          } else socket.write("250 accepted\r\n");
        }
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  return {
    messages,
    failNext() {
      failures++;
    },
    cert,
    env: {
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(port),
      SMTP_SECURE: "1",
      SMTP_USER: "e2e",
      SMTP_PASSWORD: "e2e-only",
      EMAIL_FROM: "ReeloGram <hello@example.invalid>",
      NODE_EXTRA_CA_CERTS: cert,
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export function emailBody(raw) {
  // Nodemailer encodes the text part as quoted-printable for non-ASCII content.
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([a-f0-9]{2})/gi, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}
