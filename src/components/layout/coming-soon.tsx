import { Hammer } from 'lucide-react';
import { Page, PageHeader } from './page';

/** Página provisória enquanto o módulo é construído. */
export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <Page>
      <PageHeader title={title} description={description} />
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-panel/60 px-6 py-14 text-center">
        <div aria-hidden className="size-12 rounded-xl honey-stripes" />
        <p className="inline-flex items-center gap-2 text-base font-semibold">
          <Hammer className="size-4" aria-hidden /> Em construção
        </p>
        <p className="max-w-md text-sm text-muted">Esta tela está sendo montada e chega nas próximas atualizações do app.</p>
      </div>
    </Page>
  );
}
