import { renderEmail } from "./layout.ts";
import { appOrigin } from "./transport.ts";
export { escapeEmailText } from "./layout.ts";

export const addressConfirmationEmail = (
  to: string,
  url: string,
  parent = false,
  parentEmail?: string,
) =>
  renderEmail({
    to,
    origin: new URL(url).origin,
    subject: parent
      ? "Confirm parent management on ReeloGram"
      : "Confirm your ReeloGram email",
    preview: parent
      ? "Confirm this email before managing a ReeloGram account."
      : "Confirm that this email belongs to you.",
    label: parent ? "Parent management" : "Email confirmation",
    reason: parent
      ? "Someone entered this address as the parent or guardian for a ReeloGram account. If this wasn’t expected, ignore this email."
      : "You received this email because this address was used for a ReeloGram account.",
    heading: parent
      ? "A parent’s confirmation is needed."
      : "Confirm your email.",
    paragraphs: parent
      ? [
          "Confirm only if you are the account user’s parent or guardian. You will receive account notifications and password-reset links, which allow you to manage the account.",
          "Public posting stays unavailable until the required confirmations are complete. Videos, public names and profile pictures can be visible to other visitors once posting is enabled.",
        ]
      : [
          "Use this link to confirm your email address. This helps protect your account and is required before you can publish.",
          ...(parentEmail
            ? [
                `This account has named ${parentEmail} as its parent or guardian. Confirm only if this is correct. That address will receive account emails and password-reset links that allow account access.`,
              ]
            : []),
        ],
    action: {
      url,
      label: parent ? "Review parent management" : "Confirm email",
    },
    note: {
      heading: "This link works once, for 24 hours.",
      text: "Opening the link does not confirm anything automatically. If you didn’t request this, ignore it.",
    },
  });

export const passwordResetEmail = (to: string, url: string) =>
  renderEmail({
    to,
    subject: "Reset your ReeloGram password",
    origin: new URL(url).origin,
    preview: "Your secure link to set a new password. Valid for 20 minutes.",
    label: "Password reset",
    reason:
      "You received this email because a password reset was requested for your ReeloGram account.",
    heading: "Set a new password",
    paragraphs: [
      "We received a request to reset your password. Choose a new one to get back to ReeloGram.",
    ],
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
    reason: "You received this email because you created a ReeloGram account.",
    heading: `Welcome, ${name}.`,
    paragraphs: [
      "Your ReeloGram account is ready. Discover a new perspective or share a moment of your own.",
    ],
    action: { url: new URL("/", origin).href, label: "Explore ReeloGram" },
    note: {
      heading: "Make yourself at home.",
      text: "Browse videos, settle into Reels, or upload something worth sharing.",
    },
  });

export const videoPostedEmail = (to: string, title: string, url: string) =>
  renderEmail({
    to,
    subject: "Your video is live on ReeloGram",
    origin: new URL(url).origin,
    preview: "Your upload is published and ready to watch.",
    label: "Published",
    reason: "You received this email because you posted a video on ReeloGram.",
    heading: "Your video is live.",
    paragraphs: [`“${title}” is now live on ReeloGram.`],
    action: { url, label: "Watch your video" },
    note: {
      heading: "You’re in control.",
      text: "You can edit the title and description or remove your upload at any time from Your videos.",
    },
  });

export const passwordChangedEmail = (to: string, origin = appOrigin()) =>
  renderEmail({
    to,
    subject: "Your ReeloGram password was changed",
    origin,
    preview: "Your password is updated and previous sessions have been closed.",
    label: "Account security",
    reason:
      "You received this email because your ReeloGram password was changed.",
    heading: "Your password is updated.",
    paragraphs: [
      "Your new password is ready to use. Your previous sign-ins have been closed to keep your account safe.",
    ],
    action: { url: new URL("/login", origin).href, label: "Open ReeloGram" },
    note: {
      heading: "Wasn’t you?",
      text: "Go to ReeloGram and use Forgot password to secure your account straight away.",
    },
  });
