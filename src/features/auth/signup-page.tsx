import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
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
import { passwordField } from './set-password-page';

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome.').max(80, 'Use até 80 caracteres.'),
    company: z.string().trim().min(1, 'Informe o nome da empresa.').max(120, 'Use até 120 caracteres.'),
    email: z.string().trim().email('Informe um e-mail válido.'),
    password: passwordField,
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, { message: 'As senhas não conferem.', path: ['confirm'] });

type Values = z.infer<typeof signUpSchema>;

/**
 * Criar conta: a pessoa informa o nome da empresa e, depois de confirmar o e-mail e entrar pela
 * primeira vez, o app cria a empresa dela (CompanyGate). Uma conta nova não vê nada de nenhuma
 * outra empresa: só entra em outra se for convidada por alguém que já é da empresa.
 */
export function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', company: '', email: '', password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        // O nome da empresa fica no cadastro até o primeiro acesso, quando o app a cria.
        data: { display_name: values.name, company_name: values.company },
        emailRedirectTo: `${window.location.origin}/entrar`,
      },
    });
    if (signUpError) {
      setError(describeError(signUpError));
      return;
    }
    // Com a confirmação de e-mail ligada não há sessão agora; o app abre depois do link do e-mail.
    // Mesma resposta para e-mails novos ou já cadastrados (não revela quais contas existem).
    if (!data.session) setSentTo(values.email);
  });

  const footer = (
    <span>
      Já tem conta?{' '}
      <Link className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4" to="/entrar">
        Entrar
      </Link>
    </span>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail" footer={footer}>
        <div role="status" className="space-y-3 text-sm">
          <span className="grid size-10 place-items-center rounded-lg bg-success-soft text-success">
            <MailCheck className="size-5" aria-hidden />
          </span>
          <p>
            Enviamos um link para <strong className="break-all">{sentTo}</strong>. Abra o e-mail e toque no link para ativar a conta; depois é só entrar.
          </p>
          <p className="text-muted">Não chegou? Confira a caixa de spam. Se você já tem conta com este e-mail, use “Esqueci minha senha” na tela de entrada.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Você cria a sua empresa e só vê o que for dela." footer={footer}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Seu nome" error={form.formState.errors.name?.message}>
          <Input autoComplete="name" autoFocus {...form.register('name')} />
        </Field>
        <Field label="Nome da empresa" error={form.formState.errors.company?.message}>
          <Input autoComplete="organization" placeholder="Ex.: Minha Oficina 3D" {...form.register('company')} />
        </Field>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" inputMode="email" {...form.register('email')} />
        </Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres, com letras e números." error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Repita a senha" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
