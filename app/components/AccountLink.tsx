import type { AnchorHTMLAttributes } from "react";
/** A fresh document keeps previously consented analytics code out of private account pages. */
export default function AccountLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  return <a {...props} />;
}
