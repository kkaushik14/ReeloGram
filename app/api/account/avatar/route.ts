import { after } from "next/server";
import { getServerSession } from "next-auth";
import { mediaLocation } from "@/lib/uploads/naming";
import ImageKit from "imagekit";
import { authOptions } from "@/lib/auth-opt";
import { authFailure, assertSameOrigin } from "@/lib/auth/request";
import { readAvatar } from "@/lib/account/avatar";
import {
  drainAvatarCleanup,
  queueAvatarCleanup,
  keepAvatar,
} from "@/lib/account/avatar-cleanup";
import { limitRequest } from "@/lib/security/rate-limit";
import {
  withMediaLocks,
  MediaBusyError,
  deleteMediaFile,
} from "@/lib/video-media";
import User from "@/models/User";
import { publishingAccessError } from "@/lib/account/access";

const headers = { "Cache-Control": "private, no-store" };
async function updateAvatar(req: Request, remove: boolean) {
  let uploaded: string | undefined;
  let writeAttempted = false;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return Response.json(
        { error: "Please sign in." },
        { status: 401, headers },
      );
    assertSameOrigin(req);
    const accessError = publishingAccessError(session.user);
    if (!remove && accessError)
      return Response.json({ error: accessError }, { status: 403, headers });
    await limitRequest("avatar", session.user.id, req.headers);
    const bytes = remove ? null : await readAvatar(req);
    return await withMediaLocks([`profile:${session.user.id}`], async () => {
      const user = await User.findById(session.user.id).select(
        "+imageFileId image name",
      );
      if (!user)
        return Response.json(
          { error: "Account not found." },
          { status: 404, headers },
        );
      if (user.imageFileId)
        await queueAvatarCleanup(user.imageFileId, session.user.id);
      if (bytes) {
        const publicKey = process.env.NEXT_PUBLIC_REELOGRAM_PUBLIC_KEY;
        const privateKey = process.env.REELOGRAM_PRIVATE_KEY;
        const urlEndpoint = process.env.NEXT_PUBLIC_REELOGRAM_URL_ENDPOINT;
        if (!publicKey || !privateKey || !urlEndpoint)
          throw Error("Image service unavailable");
        const imagekit = new ImageKit({ publicKey, privateKey, urlEndpoint });
        const file = await imagekit.upload({
          file: bytes,
          ...mediaLocation({
            ownerId: session.user.id,
            name: user.name,
            purpose: "profile",
          }),
          useUniqueFileName: false,
          overwriteFile: false,
          isPrivateFile: false,
        });
        uploaded = file.fileId;
        await queueAvatarCleanup(file.fileId, session.user.id);
        writeAttempted = true;
        const result = await User.updateOne(
          { _id: session.user.id },
          { $set: { image: file.url, imageFileId: file.fileId } },
        );
        if (!result.matchedCount) throw Error("Account no longer exists");
        try {
          await keepAvatar(file.fileId);
        } catch {
          console.error("Profile photo cleanup metadata will retry later");
        }
      } else {
        await User.updateOne(
          { _id: session.user.id },
          { $unset: { image: 1, imageFileId: 1 } },
        );
      }
      after(async () => {
        try {
          await drainAvatarCleanup();
        } catch {
          console.error("Profile photo cleanup will retry later");
        }
      });
      return Response.json(
        {
          message: remove ? "Profile photo removed." : "Profile photo updated.",
        },
        { headers },
      );
    });
  } catch (error) {
    if (uploaded) {
      try {
        if (!writeAttempted) await deleteMediaFile(uploaded);
        else await drainAvatarCleanup(uploaded);
      } catch {
        console.error("Profile photo cleanup needs retry");
      }
    }
    if (error instanceof MediaBusyError)
      return Response.json(
        { error: "Your profile is being updated. Please try again." },
        { status: 409, headers },
      );
    return authFailure(
      error,
      "Your profile photo couldn’t be updated. Please try again.",
    );
  }
}
export const POST = (req: Request) => updateAvatar(req, false);
export const DELETE = (req: Request) => updateAvatar(req, true);
