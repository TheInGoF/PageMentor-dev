import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "outline" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  outline: "btn-outline",
  danger: "btn-danger",
};

export function Button({ variant = "primary", className, ...rest }: Props) {
  return <button {...rest} className={cn(variantClass[variant], className)} />;
}
