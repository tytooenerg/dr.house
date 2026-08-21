import { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-white border border-border rounded-card p-6 ${className}`} {...props} />;
}

export function NavyCard({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-navy text-white rounded-card p-6 ${className}`} {...props} />;
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-end flex-wrap gap-3 mb-6">
      <div>
        <div className="text-[26px] font-extrabold tracking-tight">{title}</div>
        {subtitle && <div className="text-textSecondary text-sm mt-1">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
