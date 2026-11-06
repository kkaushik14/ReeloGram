import { Receiver } from "@upstash/qstash";
import { queueConfig, maintenanceUrl } from "@/lib/uploads/staging/queue";
import { validCronAuthorization } from "@/lib/security/cron";
import { maintainUploads } from "@/lib/uploads/staging/maintenance";
import { signedBody } from "@/lib/uploads/staging/signed-body";
export const maxDuration = 60;
async function run() {
  // Rollback disables new uploads, but existing jobs and cleanup must still drain.
  try {
    return Response.json(await maintainUploads(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
export async function GET(request: Request) {
  if (
    !validCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  )
    return new Response(null, { status: 404 });
  return run();
}
export async function POST(request: Request) {
  try {
    const { signature, body } = await signedBody(request, 0);
    if (body) return new Response(null, { status: 404 });
    if (
      !(await new Receiver(queueConfig()).verify({
        signature,
        body: "",
        url: maintenanceUrl(),
      }))
    )
      return new Response(null, { status: 404 });
    return run();
  } catch {
    return new Response(null, { status: 404 });
  }
}
