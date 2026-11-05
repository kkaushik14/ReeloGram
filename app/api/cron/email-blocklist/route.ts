import {
  blocklistCollection,
  refreshStoredBlocklist,
} from "@/lib/email/blocklist-store";
import { validCronAuthorization } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (
    !validCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    return Response.json(
      await refreshStoredBlocklist(await blocklistCollection()),
      { headers },
    );
  } catch {
    console.error(
      "Daily email blocklist refresh failed; previous snapshot retained",
    );
    return Response.json(
      { error: "Blocklist refresh unavailable; previous list retained" },
      { status: 503, headers },
    );
  }
}
