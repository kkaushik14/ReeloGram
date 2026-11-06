import { authFailure, readAuthJson } from "@/lib/auth/request";
import { uploadIdentity } from "@/lib/uploads/staging/request";
import { createAsset } from "@/lib/uploads/staging/assets";
export async function POST(request: Request) {
  try {
    const owner = await uploadIdentity(request, "upload");
    return Response.json(
      await createAsset(owner, await readAuthJson(request)),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authFailure(
      error,
      "We couldn’t prepare your upload. Please try again shortly.",
    );
  }
}
