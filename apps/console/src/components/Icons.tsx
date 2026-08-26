import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" } as const;

export function MarkIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M5 5h14v5H5z" fill="currentColor" />
      <path d="M5 14h8v5H5z" fill="currentColor" opacity=".48" />
      <path d="m16 14 3 2.5-3 2.5z" fill="currentColor" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15 15 4 4" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <rect x="8" y="8" width="10" height="10" rx="1.5" stroke="currentColor" />
      <path
        d="M15 8V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15H8"
        stroke="currentColor"
      />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M13 5h6v6M19 5l-8 8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <circle cx="7" cy="6" r="2" stroke="currentColor" />
      <circle cx="17" cy="6" r="2" stroke="currentColor" />
      <circle cx="7" cy="18" r="2" stroke="currentColor" />
      <path d="M7 8v8M9 12h3a5 5 0 0 0 5-5" stroke="currentColor" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...base} {...props} aria-hidden="true">
      <path d="M7 4h7l4 4v12H7z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M14 4v4h4M10 12h5M10 15h5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
