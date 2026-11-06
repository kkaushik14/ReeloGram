import { getServerSession } from "next-auth";
import { authOptions } from "../../auth-opt";
import { AuthRequestError, assertSameOrigin } from "../../auth/request";
import { publishingAccessError } from "../../account/access";
import { limitRequest } from "../../security/rate-limit";
import { stagingConfig, stagingEnabled } from "./config";
import { queueConfig } from "./queue";
export async function uploadIdentity(
  request: Request,
  action: "upload" | "uploadPart" | "uploadStatus" | "publish",
  publishing = true,
) {
  if (!stagingEnabled())
    throw new AuthRequestError("Resumable uploads are not enabled.", 503);
  assertSameOrigin(request);
  const session = await getServerSession(authOptions);
  if (!session?.user.id)
    throw new AuthRequestError("Sign in to manage your uploads.", 401);
  if (publishing) {
    const problem = publishingAccessError(session.user);
    if (problem) throw new AuthRequestError(problem, 403);
  }
  await limitRequest(action, session.user.id, request.headers);
  stagingConfig();
  queueConfig();
  return session.user;
}
