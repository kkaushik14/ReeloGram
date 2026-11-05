import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-opt";
import User from "@/models/User";
import { publicUploader } from "@/lib/public-uploader";
import { limitRequest, rateLimitResponse } from "@/lib/security/rate-limit";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return Response.json(
        { error: "Please sign in." },
        { status: 401, headers },
      );
    await limitRequest("profileRead", session.user.id, req.headers);
    const user = await User.findById(session.user.id).select(
      "name email image +dateOfBirth",
    );
    if (!user)
      return Response.json(
        { error: "Account not found." },
        { status: 404, headers },
      );
    const date =
      user.dateOfBirth instanceof Date &&
      Number.isFinite(user.dateOfBirth.getTime())
        ? user.dateOfBirth.toISOString().slice(0, 10)
        : null;
    return Response.json(
      {
        name: publicUploader(user).name,
        email: user.email,
        dateOfBirth: date,
        image: publicUploader(user).image || null,
      },
      { headers },
    );
  } catch (error) {
    return (
      rateLimitResponse(error) ??
      Response.json(
        { error: "Your profile is temporarily unavailable." },
        { status: 503, headers },
      )
    );
  }
}
