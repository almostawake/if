import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 'solid' = dark primary, 'ghost' = bordered secondary. */
  variant?: 'solid' | 'ghost';
};

// The one button. `type` defaults to "button" so a Button inside a form
// never submits it by accident — pass type="submit" for the one that does.
export function Button({ variant = 'solid', type = 'button', className = '', ...rest }: Props) {
  const look =
    variant === 'solid'
      ? 'bg-fg border-fg text-bg hover:bg-black hover:border-black disabled:bg-[#bbbbbb] disabled:border-[#bbbbbb] disabled:cursor-not-allowed'
      : 'bg-transparent border-border text-fg hover:bg-bg-hover';
  return (
    <button
      type={type}
      className={`rounded-[3px] border px-3 py-1.5 whitespace-nowrap ${look} ${className}`}
      {...rest}
    />
  );
}
