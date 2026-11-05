import type { EmailMessage } from "./transport";

export const escapeEmailText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

type EmailContent = {
  to: string;
  subject: string;
  origin: string;
  preview: string;
  label: string;
  heading: string;
  paragraphs: string[];
  reason?: string;
  action?: { url: string; label: string };
  note?: { heading: string; text: string };
};

function webUrl(value: string) {
  const url = new URL(value);
  if (
    url.username || url.password ||
    (url.protocol !== "https:" && !(
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ))
  ) throw new Error("Email links require a trusted HTTPS address");
  return url;
}

/** Table layout and inline styles keep the same readable card in webmail and Outlook. */
export function renderEmail(content: EmailContent): EmailMessage {
  const { to, subject, preview, label, heading, paragraphs, action, note } = content;
  const reason = content.reason || "An update about your ReeloGram account.";
  const origin = webUrl(content.origin).origin;
  const actionUrl = action ? webUrl(action.url).href : undefined;
  if (actionUrl && new URL(actionUrl).origin !== origin)
    throw new Error("Email actions must stay on the app's origin");
  const e = escapeEmailText;
  const text = [
    "ReeloGram", heading, ...paragraphs,
    ...(action && actionUrl ? [`${action.label}: ${actionUrl}`] : []),
    ...(note ? [`${note.heading}\n${note.text}`] : []),
    reason, `Help: ${origin}/help`, `Privacy policy: ${origin}/privacy`, `Terms of use: ${origin}/terms`,
  ].join("\n\n");
  return {
    to, subject, text,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(subject)}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{border-collapse:collapse}img{border:0;outline:none;text-decoration:none}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media screen and (max-width:600px){.email-outer{padding:24px 12px!important}.email-content{padding:28px 24px!important}.email-header{padding:26px 24px!important}.email-heading{font-size:28px!important;line-height:36px!important}.email-button{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;width:100%;background-color:#F5F4F2;color:#27272A;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;font-size:1px;line-height:1px;color:#F5F4F2;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${e(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F4F2"><tr><td class="email-outer" align="center" style="padding:48px 20px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E2E0DE;border-radius:20px">
<tr><td height="5" bgcolor="#6A4D77" style="height:5px;line-height:5px;font-size:1px;background-color:#6A4D77;border-radius:20px 20px 0 0">&nbsp;</td></tr>
<tr><td class="email-header" style="padding:32px 40px;border-bottom:1px solid #EFEEEC">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="44" style="width:44px;padding-right:12px;vertical-align:middle"><a href="${e(origin)}/" style="text-decoration:none"><img src="${e(origin)}/email-logo.png" alt="" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:10px"></a></td><td style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.8px;color:#27272A"><a href="${e(origin)}/" style="text-decoration:none;color:#6A4D77">ReeloGram<span style="color:#6A4D77">.</span></a></td></tr></table>
</td></tr>
<tr><td class="email-content" style="padding:36px 40px 40px">
<p style="margin:0 0 16px;font-size:14px;line-height:22px;font-weight:700;color:#6A4D77">${e(label)}</p>
<h1 class="email-heading" style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:40px;letter-spacing:-0.8px;font-weight:700;color:#27272A">${e(heading)}</h1>
${paragraphs.map(p => `<p style="margin:0 0 16px;font-size:17px;line-height:28px;color:#525159;overflow-wrap:anywhere">${e(p)}</p>`).join("\n")}
${action && actionUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 0 28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#6A4D77" style="background-color:#6A4D77;border-radius:10px;mso-padding-alt:16px 24px"><a class="email-button" href="${e(actionUrl)}" style="display:inline-block;padding:16px 24px;border:1px solid #6A4D77;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;color:#FFFFFF;mso-padding-alt:0">${e(action.label)}</a></td></tr></table></td></tr></table>` : ""}
${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F0E9F1" style="background-color:#F0E9F1;border-radius:12px"><tr><td style="padding:20px 22px"><p style="margin:0 0 6px;font-size:15px;line-height:23px;font-weight:700;color:#5A4264">${e(note.heading)}</p><p style="margin:0;font-size:15px;line-height:24px;color:#525159">${e(note.text)}</p></td></tr></table>` : ""}
${action && actionUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed"><tr><td style="padding-top:28px"><p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#66656A">Button not working? Copy this link into your browser:</p><p style="margin:0;font-size:14px;line-height:22px;word-break:break-all;overflow-wrap:anywhere"><a href="${e(actionUrl)}" style="color:#6A4D77;text-decoration:underline;word-break:break-all">${e(actionUrl)}</a></p></td></tr></table>` : ""}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px"><tr><td align="center" style="padding:24px 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:23px;color:#66656A"><p style="margin:0 0 12px">${e(reason)}</p><p style="margin:0 0 12px"><a href="${e(origin)}/help" style="color:#66656A;text-decoration:underline">Help</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${e(origin)}/privacy" style="color:#66656A;text-decoration:underline">Privacy policy</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${e(origin)}/terms" style="color:#66656A;text-decoration:underline">Terms of use</a></p><p style="margin:0">&copy; ${new Date().getFullYear()} <strong style="color:#6A4D77">ReeloGram</strong></p></td></tr></table>
</td></tr></table></body></html>`,
  };
}
