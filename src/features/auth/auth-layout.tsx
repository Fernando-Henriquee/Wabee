import type { ReactNode } from 'react';
import { BrandMark, BrandName } from '@/components/layout/brand';
import { LocalEnvBanner } from '@/components/layout/banners';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LocalEnvBanner />
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 top-10 h-48 w-48 rotate-12 rounded-[2.5rem] honey-stripes opacity-25" />
        <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-12 size-56 rounded-full honey-stripes opacity-20" />
        <div className="relative w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <BrandMark className="size-14 rounded-2xl shadow-[var(--shadow-card)]" />
            <BrandName className="mt-3 text-4xl" />
            <p className="mt-1 text-sm text-muted">Produção, estoque e financeiro</p>
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
