import {
  authFailure,
  readAuthJson,
  AuthRequestError,
} from "@/lib/auth/request";
import { uploadIdentity } from "@/lib/uploads/staging/request";
import {
  resumeAsset,
  signParts,
  finishAsset,
  cancelAsset,
} from "@/lib/uploads/staging/assets";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request, context: Context) {
  try {
    const owner = await uploadIdentity(request, "uploadStatus", false);
    return Response.json(
      await resumeAsset(owner.id, (await context.params).id),
      { headers },
    );
  } catch (error) {
    return authFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const owner = await uploadIdentity(request, "uploadPart"),
      { id } = await context.params,
      body = await readAuthJson(request);
    if (body.action === "sign")
      return Response.json(
        { parts: await signParts(owner.id, id, body) },
        { headers },
      );
    if (body.action === "complete")
      return Response.json(await finishAsset(owner.id, id), { headers });
    throw new AuthRequestError("Unknown upload operation.");
  } catch (error) {
    return authFailure(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const owner = await uploadIdentity(request, "uploadPart", false);
    await cancelAsset(owner.id, (await context.params).id);
    return Response.json({ cancelled: true }, { headers });
  } catch (error) {
    return authFailure(error);
  }
}
