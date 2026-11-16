import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-sky text-white hover:bg-sky-hover disabled:bg-sky/50",
  secondary: "border border-border bg-white text-marine hover:bg-canvas",
  quiet: "text-marine hover:bg-canvas",
  danger: "bg-danger text-white hover:bg-red-700 disabled:bg-danger/50",
};

export function Button({
  children,
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  className = "",
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors ${variantClasses[variant].replaceAll(" disabled:bg-sky/50", "").replaceAll(" disabled:bg-danger/50", "")} ${className}`}
    >
      {children}
    </Link>
  );
}
