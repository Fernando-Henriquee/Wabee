import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

const controlBase =
  'w-full rounded-lg border border-line-strong bg-panel px-3 text-sm text-ink placeholder:text-muted/80 transition-colors focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, 'h-10', className)} {...useFieldControl(props)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlBase, 'min-h-20 py-2', className)} {...useFieldControl(props)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const props = useFieldControl(rest);
  return (
    <select className={cn(controlBase, 'h-10 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27%2375604f%27%3E%3Cpath d=%27M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%27/%3E%3C/svg%3E")] bg-[length:1.1rem] bg-[right_0.6rem_center] bg-no-repeat pr-9', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="checkbox" className={cn('size-4 rounded border-line-strong accent-brand', className)} {...props} />;
}
