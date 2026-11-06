import { verifyUploadRequest } from "@/lib/uploads/staging/queue";
import { processJob } from "@/lib/uploads/staging/jobs";
import { validUploadId } from "@/lib/uploads/staging/policy";
import { signedBody } from "@/lib/uploads/staging/signed-body";
export const maxDuration = 60;
export async function POST(request: Request) {
  let signature: string, body: string;
  try {
    ({ signature, body } = await signedBody(request));
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!(await verifyUploadRequest(signature, body)))
    return new Response(null, { status: 404 });
  try {
    const data = JSON.parse(body);
    if (!validUploadId(data.id)) return new Response(null, { status: 400 });
    const result = await processJob(data.id);
    return Response.json(
      { complete: result.done },
      {
        status: result.done ? 200 : 503,
        headers: {
          "Cache-Control": "no-store",
          ...(!result.done
            ? { "Retry-After": String(result.retryAfter ?? 30) }
            : {}),
        },
      },
    );
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }
}
