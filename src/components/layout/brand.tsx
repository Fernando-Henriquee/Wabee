import { cn } from '@/lib/cn';

export function BrandMark({ className }: { className?: string }) {
  return <img src="/icon.svg" alt="" width={36} height={36} className={cn('size-9 rounded-xl', className)} />;
}

/** Wordmark "wabee." da logo: "b" e ponto com as listras cor de mel. */
export function BrandName({ className, store = false }: { className?: string; store?: boolean }) {
  return (
    <span className={cn('inline-flex flex-col text-xl leading-none', className)}>
      <span className="font-display font-extrabold tracking-[-0.04em] text-ink" aria-label="Wabee">
        wa<span className="honey-text">b</span>ee<span className="honey-text">.</span>
      </span>
      {store ? <span className="mt-0.5 self-end pr-0.5 text-[0.6rem] font-medium tracking-[0.35em] text-ink-soft">gestão</span> : null}
    </span>
  );
}
