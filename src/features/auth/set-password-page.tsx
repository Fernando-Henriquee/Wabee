import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { describeError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from './auth-context';
import { AuthLayout } from './auth-layout';
import { PasswordInput } from './password-input';

export const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Use pelo menos 8 caracteres.')
      .regex(/[A-Za-z]/, 'Inclua pelo menos uma letra.')
      .regex(/\d/, 'Inclua pelo menos um número.'),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, { message: 'As senhas não conferem.', path: ['confirm'] });

type Values = z.infer<typeof passwordSchema>;

/** Definição de senha após link de recuperação ou convite. */
export function SetPasswordPage() {
  const { session, clearPasswordSetup } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(passwordSchema), defaultValues: { password: '', confirm: '' } });

  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado" subtitle="Peça um novo link de recuperação de senha.">
        <Button asChild className="w-full">
          <Link to="/recuperar-senha">Pedir novo link</Link>
        </Button>
      </AuthLayout>
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(describeError(updateError));
      return;
    }
    toast.success('Senha definida com sucesso.');
    navigate('/', { replace: true });
    clearPasswordSetup();
  });

  return (
    <AuthLayout title="Definir nova senha" subtitle={session.user.email ?? undefined}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Nova senha" hint="Mínimo de 8 caracteres, com letras e números." error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <Field label="Confirme a nova senha" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Salvar senha
        </Button>
      </form>
    </AuthLayout>
  );
}
