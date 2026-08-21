import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-blue text-white hover:opacity-90 disabled:bg-[#B8C2D4] disabled:opacity-100',
  secondary: 'bg-white text-navy border border-inputBorder hover:bg-bg',
  ghost: 'bg-transparent text-textSecondary hover:text-navy',
  danger: 'bg-redBg text-red border border-[#E9CFCB] hover:opacity-90',
  success: 'bg-green text-white hover:opacity-90',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-[12.5px] rounded-md',
  md: 'px-4 py-2.5 text-[13.5px] rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`font-bold cursor-pointer transition-opacity disabled:cursor-default ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = 'Button';
