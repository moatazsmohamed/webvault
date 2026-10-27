import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from './icons';

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold sm:text-xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({ label, value, icon, tone = 'var(--accent)', hint }: { label: string; value: number | string; icon: IconName; tone?: string; hint?: string }) {
  return (
    <div className="card card-pad flex items-center gap-3 animate-fade-up">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `color-mix(in srgb, ${tone} 15%, transparent)`, color: tone }}>
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-none">{value}</p>
        <p className="mt-1 truncate text-xs muted">{label}</p>
        {hint ? <p className="truncate text-[11px] faint">{hint}</p> : null}
      </div>
    </div>
  );
}

export function Panel({ title, icon, action, children, className = '' }: { title: string; icon?: IconName; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card flex flex-col ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon ? <Icon name={icon} size={16} /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="flex-1 px-4 py-3.5">{children}</div>
    </section>
  );
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link-quiet text-xs hover:text-txt-hi">
      {children}
    </Link>
  );
}

export function Callout({ tone = 'info', icon = 'alert', children }: { tone?: 'info' | 'warn' | 'ok'; icon?: IconName; children: ReactNode }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--accent)';
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm"
      style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
    >
      <span className="mt-0.5 shrink-0" style={{ color }}>
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
