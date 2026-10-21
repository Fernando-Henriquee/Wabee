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
import { PasswordInput } from './password-input';

const schema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

type Values = z.infer<typeof schema>;

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
    if (signInError) setError(describeError(signInError));
  });

  return (
    <AuthLayout title="Entrar" subtitle="Acesso restrito a contas convidadas." footer={<Link className="text-accent-ink hover:underline" to="/recuperar-senha">Esqueci minha senha</Link>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" inputMode="email" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Senha" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
