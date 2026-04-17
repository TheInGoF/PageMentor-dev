import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function Input({ label, className, id, ...rest }: Props) {
  const inputId = id || rest.name;
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-neutral-400">
          {label}
        </label>
      )}
      <input id={inputId} {...rest} className={cn("input", className)} />
    </div>
  );
}
