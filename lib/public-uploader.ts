export function publicUploader(user: {
  _id: unknown;
  email?: string;
  name?: string;
  image?: string;
}) {
  const name =
    user.name?.trim() || user.email?.split("@")[0] || "Community member";
  let image: string | undefined;
  try {
    const url = new URL(user.image ?? "");
    if (url.protocol === "https:") image = url.toString();
  } catch {}
  return { id: String(user._id), name, image };
}
