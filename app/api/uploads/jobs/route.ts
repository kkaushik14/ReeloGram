import { authFailure, readAuthJson } from "@/lib/auth/request";
import { uploadIdentity } from "@/lib/uploads/staging/request";
import { createJob, dispatchJob } from "@/lib/uploads/staging/jobs";
import {
  uploadCollections,
  presentJob,
} from "@/lib/uploads/staging/repository";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  try {
    const owner = await uploadIdentity(request, "publish");
    return Response.json(await createJob(owner, await readAuthJson(request)), {
      status: 202,
      headers,
    });
  } catch (error) {
    return authFailure(error);
  }
}
export async function GET(request: Request) {
  try {
    const owner = await uploadIdentity(request, "uploadStatus", false),
      { jobs } = await uploadCollections();
    const records = await jobs
      .find({
        owner: owner.id,
        createdAt: { $gt: new Date(Date.now() - 7 * 86400000) },
      })
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray();
    // Also recover saved queue intents while the owner checks status.
    await Promise.allSettled(
      records
        .filter((j) => j.status === "queued" || j.status === "processing")
        .slice(0, 2)
        .map(dispatchJob),
    );
    return Response.json({ jobs: records.map(presentJob) }, { headers });
  } catch (error) {
    return authFailure(error);
  }
}
