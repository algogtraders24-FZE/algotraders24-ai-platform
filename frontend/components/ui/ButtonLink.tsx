// components/ui/ButtonLink.tsx
// Sprint D1.0 - A Next.js Link styled exactly like Button, for CTAs that
// navigate rather than perform an in-page action (a real <a>/<Link>, never
// a <button> wrapping one - that's invalid HTML and breaks middle-click/
// open-in-new-tab). Shares buttonClasses with Button so the two can never
// visually drift apart.
import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export default function ButtonLink({ variant = "primary", size = "md", fullWidth = false, className = "", ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, fullWidth, className)} {...rest} />;
}
