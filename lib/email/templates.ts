import type { EmailMessage } from "./transport";
export const escapeEmailText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
function message(
  to: string,
  subject: string,
  heading: string,
  body: string,
  link?: { url: string; label: string },
): EmailMessage {
  return {
    to,
    subject,
    text: `${heading}\n\n${body}${link ? `\n\n${link.label}: ${link.url}` : ""}\n\nReeloGram`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f2f5;font-family:Arial,sans-serif;color:#29252e"><main style="max-width:520px;margin:32px auto;padding:32px;background:white;border-radius:20px"><p style="font-size:20px;font-weight:700">ReeloGram.</p><h1 style="font-size:26px">${escapeEmailText(heading)}</h1><p style="font-size:16px;line-height:1.7">${escapeEmailText(body)}</p>${link ? `<p style="margin:28px 0"><a style="display:inline-block;padding:14px 20px;background:#634b70;color:white;border-radius:10px;text-decoration:none;font-weight:bold" href="${escapeEmailText(link.url)}">${escapeEmailText(link.label)}</a></p><p style="font-size:14px;overflow-wrap:anywhere">Or open this link: ${escapeEmailText(link.url)}</p>` : ""}</main></body></html>`,
  };
}
export const passwordResetEmail = (to: string, url: string) =>
  message(
    to,
    "Reset your ReeloGram password",
    "Choose a new password",
    "Use this link within 20 minutes. It works once. If you didn’t request a password reset, you can ignore this email.",
    { url, label: "Set a new password" },
  );
export const accountCreatedEmail = (to: string, name: string, origin: string) =>
  message(
    to,
    "Welcome to ReeloGram",
    `Welcome, ${name}.`,
    "Your account is ready. Discover a new perspective or share a moment of your own.",
    { url: origin + "/", label: "Open ReeloGram" },
  );
export const videoPostedEmail = (to: string, title: string, url: string) =>
  message(
    to,
    "Your video is live on ReeloGram",
    "Your story is ready to watch.",
    `“${title}” has been posted. You can edit its title and description or remove it from Your videos.`,
    { url, label: "Watch your video" },
  );
export const passwordChangedEmail = (to: string) =>
  message(
    to,
    "Your ReeloGram password was changed",
    "Your password has been updated.",
    "Your previous sign-ins have been closed. Use your new password to sign in. If you didn’t make this change, reset your password immediately.",
  );
