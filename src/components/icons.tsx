import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 18, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...rest,
});

export const GLYPHS = {
  vault: (p: P) => (<svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="3.6" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></svg>),
  grid: (p: P) => (<svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>),
  folder: (p: P) => (<svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>),
  globe: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></svg>),
  key: (p: P) => (<svg {...base(p)}><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5 20 3M15 8l2.5 2.5M18 5l2 2" /></svg>),
  search: (p: P) => (<svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>),
  settings: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 4.9 19.5l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.5 4.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>),
  plus: (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>),
  edit: (p: P) => (<svg {...base(p)}><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" /></svg>),
  trash: (p: P) => (<svg {...base(p)}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>),
  copy: (p: P) => (<svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>),
  eye: (p: P) => (<svg {...base(p)}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></svg>),
  eyeOff: (p: P) => (<svg {...base(p)}><path d="M4 4l16 16M9.5 9.6A3 3 0 0 0 12 15a3 3 0 0 0 2.5-1.4M6.6 6.8C3.9 8.4 2 12 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.4 4.5-1.1M14.5 5.8A9.7 9.7 0 0 0 12 5.5C8.4 5.5 5.6 7.2 4 8.6" /></svg>),
  external: (p: P) => (<svg {...base(p)}><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>),
  lock: (p: P) => (<svg {...base(p)}><rect x="4.5" y="10" width="15" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>),
  unlock: (p: P) => (<svg {...base(p)}><rect x="4.5" y="10" width="15" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></svg>),
  shield: (p: P) => (<svg {...base(p)}><path d="M12 3l8 3v6c0 4.6-3.2 8.3-8 9.5-4.8-1.2-8-4.9-8-9.5V6z" /></svg>),
  check: (p: P) => (<svg {...base(p)}><path d="m5 13 4.5 4.5L19 7" /></svg>),
  alert: (p: P) => (<svg {...base(p)}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.2v.1" /></svg>),
  x: (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>),
  menu: (p: P) => (<svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>),
  sun: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>),
  moon: (p: P) => (<svg {...base(p)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>),
  logout: (p: P) => (<svg {...base(p)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8l-4 4 4 4M6 12h10" /></svg>),
  code: (p: P) => (<svg {...base(p)}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" /></svg>),
  server: (p: P) => (<svg {...base(p)}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5v.1M7 16.5v.1" /></svg>),
  clock: (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>),
  spark: (p: P) => (<svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>),
  download: (p: P) => (<svg {...base(p)}><path d="M12 4v10M8 11l4 4 4-4" /><path d="M5 19h14" /></svg>),
  filter: (p: P) => (<svg {...base(p)}><path d="M4 6h16l-6 7v5l-4 2v-7z" /></svg>),
};

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = GLYPHS[name] ?? GLYPHS.spark;
  return <Glyph size={size} className={className} aria-hidden focusable={false} />;
}
