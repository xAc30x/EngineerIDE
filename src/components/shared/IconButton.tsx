import type { ReactNode } from 'react';

interface IconButtonProps {
  /** Used as both the tooltip and the accessible name. */
  label: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** Square button that shows only an icon. */
export function IconButton({
  label,
  onClick,
  isActive = false,
  disabled = false,
  className = '',
  children,
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isActive || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 ${
        isActive ? 'bg-hover text-fg' : 'text-muted'
      } ${className}`}
    >
      {children}
    </button>
  );
}
