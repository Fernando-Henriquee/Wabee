import type { ReactNode } from 'react';
import { BrandMark } from '@/components/layout/brand';
import { LocalEnvBanner } from '@/components/layout/banners';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LocalEnvBanner />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/40 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-accent-soft blur-3xl" />
        <div className="relative w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <BrandMark className="size-14 rounded-2xl shadow-[var(--shadow-card)]" />
            <p className="mt-3 font-display text-3xl font-semibold">Magi Doces</p>
            <p className="text-sm text-muted">Doces artesanais · gestão</p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-6 shadow-[var(--shadow-card)]">
            <h1 className="font-sans text-lg font-semibold">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
            <div className="mt-5">{children}</div>
          </div>
          {footer ? <div className="mt-4 text-center text-sm text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
