import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from './auth-layout';

const schema = z.object({ email: z.string().trim().email('Informe um e-mail válido.') });

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    // Mesma resposta para e-mails existentes ou não (não revela quais contas existem).
    if (resetError && !/not found/i.test(resetError.message)) setError(describeError(resetError));
    else setSent(true);
  });

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      footer={<Link className="text-ink underline decoration-accent decoration-2 underline-offset-4" to="/entrar">Voltar para o login</Link>}
    >
      {sent ? (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-3 text-sm text-success">
          Se houver uma conta com este e-mail, você receberá o link em instantes. Confira também a caixa de spam.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="E-mail" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" inputMode="email" autoFocus {...form.register('email')} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
