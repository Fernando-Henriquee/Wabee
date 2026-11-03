import { cn } from '@/lib/cn';
import { photoUrl } from '@/lib/photo-url';
import { initials } from '@/lib/text';

const THUMB_TONES = ['bg-accent-soft text-accent-ink', 'bg-info-soft text-info', 'bg-success-soft text-success', 'bg-subtle text-ink-soft', 'bg-warning-soft text-warning'];

/** Foto do produto ou iniciais (cor estável pelo nome). */
export function ProductThumb({ name, photoPath, className }: { name: string; photoPath?: string | null; className?: string }) {
  const url = photoUrl(photoPath);
  const tone = THUMB_TONES[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % THUMB_TONES.length];
  if (url) return <img src={url} alt="" loading="lazy" decoding="async" className={cn('rounded-lg object-cover', className)} />;
  return (
    <span aria-hidden className={cn('grid place-items-center rounded-lg font-display text-lg font-bold', tone, className)}>
      {initials(name)}
    </span>
  );
}
