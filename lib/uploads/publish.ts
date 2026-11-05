export type PublishInput = {
  title: string;
  description: string;
  fileId: string;
  thumbnailFileId: string;
};

/** Manual retries reuse the uploaded IDs; never automatically repeat an uncertain POST. */
export async function publishVideo(input: PublishInput) {
  let response: Response;
  try {
    response = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw Error(
      "We couldn’t confirm publication. Your files are kept on this page. Check Your videos before trying again.",
    );
  }
  if (response.ok) return;
  let message =
    "Your files are uploaded, but publishing is temporarily unavailable. Please try again.";
  if (response.status === 401)
    message =
      "Your sign-in has expired. Sign in again in another tab, then retry here. Your uploaded files are kept on this page.";
  else if (response.status === 429)
    message =
      "You’ve reached the posting limit. Please wait before trying again. Your uploaded files are kept on this page.";
  else if (response.status === 413)
    message =
      "The publishing details are too large. Shorten the title or description and try again.";
  else if (response.status === 409)
    message =
      "This video is already shared or another request is still publishing it. Check Your videos before retrying.";
  try {
    const body = await response.json();
    if (
      response.status !== 401 &&
      response.status !== 429 &&
      typeof body.error === "string" &&
      body.error.trim()
    )
      message = body.error.slice(0, 500);
  } catch {
    /* A proxy can return HTML instead of an API response. */
  }
  throw Error(message);
}
