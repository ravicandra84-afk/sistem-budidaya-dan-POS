import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import type { ReactNode } from "react";

const controlClass =
  "min-h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-marine outline-none transition focus:border-sky focus:ring-2 focus:ring-sky/15 disabled:bg-canvas";

export function Field({
  id,
  label,
  hint,
  children,
  required,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-marine">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`${controlClass} ${props.className ?? ""}`} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${controlClass} ${props.className ?? ""}`} />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-28 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-marine outline-none transition focus:border-sky focus:ring-2 focus:ring-sky/15 ${props.className ?? ""}`}
    />
  );
}
