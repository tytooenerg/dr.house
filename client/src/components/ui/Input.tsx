import { InputHTMLAttributes, ReactElement, SelectHTMLAttributes, TextareaHTMLAttributes, cloneElement, isValidElement, useId } from 'react';

export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const generatedId = useId();
  const resolvedId = (isValidElement(children) ? children.props.id : undefined) ?? generatedId;
  const child = isValidElement(children) ? cloneElement(children, { id: resolvedId }) : children;
  return (
    <div>
      <label htmlFor={resolvedId} className="block text-[12.5px] font-bold text-textSecondary mb-1.5">
        {label}
      </label>
      {child}
    </div>
  );
}

export function Input({ className = '', mono = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      className={`w-full px-3.5 py-3 rounded-lg border border-inputBorder outline-none text-sm focus:border-blue transition-colors ${mono ? 'font-mono-num' : ''} ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`px-3.5 py-3 rounded-lg border border-inputBorder outline-none text-[13.5px] bg-white cursor-pointer ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full px-3.5 py-3 rounded-lg border border-inputBorder outline-none text-sm focus:border-blue transition-colors ${className}`}
      {...props}
    />
  );
}
