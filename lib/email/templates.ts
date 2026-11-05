import { renderEmail } from "./layout.ts";
import { appOrigin } from "./transport.ts";
export { escapeEmailText } from "./layout.ts";

export const passwordResetEmail = (to: string, url: string) =>
  renderEmail({
    to,
    subject: "Reset your ReeloGram password",
    origin: new URL(url).origin,
    preview: "Your secure link to set a new password. Valid for 20 minutes.",
    label: "Password reset",
    heading: "Set a new password",
    paragraphs: ["We received a request to reset your password. Choose a new one to get back to ReeloGram."],
    action: { url, label: "Set a new password" },
    note: {
      heading: "This link works once, for 20 minutes.",
      text: "If you didn’t request this, you can ignore this email. Your password will stay the same.",
    },
  });

export const accountCreatedEmail = (to: string, name: string, origin: string) =>
  renderEmail({
    to,
    subject: "Welcome to ReeloGram",
    origin,
    preview: "Your account is ready. Find your next favourite moment.",
    label: "You’re in",
    heading: `Welcome, ${name}.`,
    paragraphs: ["Your ReeloGram account is ready. Discover a new perspective or share a moment of your own."],
    action: { url: new URL("/", origin).href, label: "Explore ReeloGram" },
    note: { heading: "Make yourself at home.", text: "Browse videos, settle into Reels, or upload something worth sharing." },
  });

export const videoPostedEmail = (to: string, title: string, url: string) =>
  renderEmail({
    to,
    subject: "Your video is live on ReeloGram",
    origin: new URL(url).origin,
    preview: "Your upload is published and ready to watch.",
    label: "Published",
    heading: "Your video is live.",
    paragraphs: [`“${title}” is now live on ReeloGram.`],
    action: { url, label: "Watch your video" },
    note: { heading: "You’re in control.", text: "You can edit the title and description or remove your upload at any time from Your videos." },
  });

export const passwordChangedEmail = (to: string, origin = appOrigin()) =>
  renderEmail({
    to,
    subject: "Your ReeloGram password was changed",
    origin,
    preview: "Your password is updated and previous sessions have been closed.",
    label: "Account security",
    heading: "Your password is updated.",
    paragraphs: ["Your new password is ready to use. Your previous sign-ins have been closed to keep your account safe."],
    action: { url: new URL("/login", origin).href, label: "Open ReeloGram" },
    note: { heading: "Wasn’t you?", text: "Go to ReeloGram and use Forgot password to secure your account straight away." },
  });
