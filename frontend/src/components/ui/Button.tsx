import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "ghost" | "text";

type BaseProps = {
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

type ButtonAsLink = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function variantClass(variant: ButtonVariant): string {
  switch (variant) {
    case "ghost":
      return "btn btn-ghost";
    case "text":
      return "btn btn-text";
    default:
      return "btn btn-primary";
  }
}

export function Button(props: ButtonProps) {
  const { variant = "primary", className, children } = props;
  const classes = [variantClass(variant), className].filter(Boolean).join(" ");

  if ("href" in props && typeof props.href === "string") {
    const { href, variant: _v, className: _c, children: _ch, ...linkRest } = props;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {children}
      </Link>
    );
  }

  const { variant: _v, className: _c, children: _ch, href: _h, ...buttonRest } =
    props as ButtonAsButton;

  return (
    <button type="button" className={classes} {...buttonRest}>
      {children}
    </button>
  );
}
