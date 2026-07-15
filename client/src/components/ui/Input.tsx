import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] font-bold text-textSecondary mb-1.5">{label}</div>
      {children}
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
