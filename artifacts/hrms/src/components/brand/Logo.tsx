import React from 'react';
import { cn } from '@/lib/utils';

/**
 * GridMindHR icon mark — abstract grid/network symbol with a central person silhouette.
 * Palette: Deep Navy #0B1D33 · Teal #0EA5A3 · Green #22C55E
 */
export function GridMindIconMark({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" fill="#0B1D33" />
      {/* Network lines — teal */}
      <line x1="7" y1="7" x2="16" y2="16" stroke="#0EA5A3" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      <line x1="25" y1="7" x2="16" y2="16" stroke="#0EA5A3" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      <line x1="7" y1="25" x2="16" y2="16" stroke="#0EA5A3" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      <line x1="25" y1="25" x2="16" y2="16" stroke="#0EA5A3" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      <line x1="16" y1="3.5" x2="16" y2="12" stroke="#0EA5A3" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
      <line x1="28.5" y1="16" x2="20" y2="16" stroke="#0EA5A3" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
      <line x1="16" y1="28.5" x2="16" y2="20" stroke="#0EA5A3" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
      <line x1="3.5" y1="16" x2="12" y2="16" stroke="#0EA5A3" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
      {/* Corner nodes */}
      <circle cx="7" cy="7" r="2.2" fill="#0EA5A3" />
      <circle cx="25" cy="7" r="2.2" fill="#0EA5A3" />
      <circle cx="7" cy="25" r="2.2" fill="#0EA5A3" />
      <circle cx="25" cy="25" r="2.2" fill="#0EA5A3" />
      {/* Edge nodes */}
      <circle cx="16" cy="3.5" r="1.5" fill="#0EA5A3" opacity="0.6" />
      <circle cx="28.5" cy="16" r="1.5" fill="#0EA5A3" opacity="0.6" />
      <circle cx="16" cy="28.5" r="1.5" fill="#0EA5A3" opacity="0.6" />
      <circle cx="3.5" cy="16" r="1.5" fill="#0EA5A3" opacity="0.6" />
      {/* Person silhouette — green */}
      <circle cx="16" cy="13.5" r="3" fill="#22C55E" />
      <path d="M10.5 22 C10.5 18.5 13 17 16 17 C19 17 21.5 18.5 21.5 22 Z" fill="#22C55E" />
    </svg>
  );
}

/**
 * Full GridMindHR wordmark — icon mark + typographic wordmark.
 * size: "sm" (sidebar), "md" (card header), "lg" (login hero)
 */
export function GridMindLogo({
  size = 'md',
  className,
  dark = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Force light wordmark text (for dark backgrounds). Defaults to theme-aware. */
  dark?: boolean;
}) {
  const iconSize = size === 'sm' ? 28 : size === 'md' ? 36 : 56;
  const textClass =
    size === 'sm'
      ? 'text-sm font-semibold tracking-tight leading-none'
      : size === 'md'
      ? 'text-base font-semibold tracking-tight leading-none'
      : 'text-4xl font-bold tracking-tight leading-none';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <GridMindIconMark size={iconSize} />
      <span
        className={cn(
          textClass,
          dark ? 'text-white' : 'text-[#0B1D33] dark:text-white',
        )}
      >
        <span>GridMind</span>
        <span className="text-[#22C55E]">HR</span>
      </span>
    </div>
  );
}
