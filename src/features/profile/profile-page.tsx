import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Page, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useMyProfile, useSaveDisplayName } from '@/data/settings';
import { useAuth } from '@/features/auth/auth-context';
import { PasswordInput } from '@/features/auth/password-input';
import { passwordSchema } from '@/features/auth/set-password-page';
import { ROLE_LABELS, useMember } from '@/features/member/member-context';
import { ensureOnline } from '@/lib/connectivity';
import { describeError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const nameSchema = z.object({
  displayName: z.string().trim().min(1, 'Informe o nome de exibição.').max(80, 'Use no máximo 80 caracteres.'),
});

function NameForm() {
  const { user } = useAuth();
  const profile = useMyProfile();
  const save = useSaveDisplayName();
  const form = useForm<{ displayName: string }>({ resolver: zodResolver(nameSchema), defaultValues: { displayName: '' } });
  const { reset } = form;
  const current = profile.data?.display_name ?? (user?.user_metadata?.display_name as string | undefined) ?? '';

  useEffect(() => {
    reset({ displayName: current });
  }, [current, reset]);

  return (
    <Card>
      <CardHeader title="Seus dados" description="O nome aparece no histórico de operações e na auditoria." />
      <form
        className="space-y-4 p-4"
        noValidate
        onSubmit={form.handleSubmit(({ displayName }) => save.mutateAsync({ displayName: displayName.trim() }).catch(() => undefined))}
      >
        <Field label="E-mail" hint="Para trocar o e-mail, peça ao dono do sistema.">
          <Input type="email" value={user?.email ?? ''} readOnly className="bg-subtle" />
        </Field>
        <Field label="Nome de exibição" required error={form.formState.errors.displayName?.message}>
          <Input autoComplete="name" {...form.register('displayName')} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
            Salvar nome
          </Button>
        </div>
      </form>
    </Card>
  );
}

type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordForm() {
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { password: '', confirm: '' } });
  const change = useMutation({
    networkMode: 'always',
    mutationFn: async (password: string) => {
      await ensureOnline();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Senha alterada.');
      form.reset({ password: '', confirm: '' });
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Card>
      <CardHeader title="Senha" description="Use pelo menos 8 caracteres, com letras e números." />
      <form className="space-y-4 p-4" noValidate onSubmit={form.handleSubmit(({ password }) => change.mutateAsync(password).catch(() => undefined))}>
        <Field label="Nova senha" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Confirme a nova senha" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={change.isPending}>
            Alterar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Sessions() {
  const { signOut } = useAuth();
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  return (
    <Card>
      <CardHeader title="Sessões" description="Ao sair, os dados salvos neste aparelho para uso offline são apagados." />
      <div className="flex flex-col gap-2 p-4 sm:flex-row">
        <Button variant="outline" onClick={() => void signOut('local')}>
          <LogOut /> Sair deste aparelho
        </Button>
        <Button variant="danger-outline" onClick={() => setConfirmGlobal(true)}>
          <ShieldCheck /> Sair de todos os aparelhos
        </Button>
      </div>
      <ConfirmDialog
        open={confirmGlobal}
        onOpenChange={setConfirmGlobal}
        title="Sair de todos os aparelhos?"
        description="Todas as sessões desta conta serão encerradas, inclusive em outros celulares e computadores. Use se perdeu um aparelho ou suspeita de acesso indevido."
        confirmLabel="Sair de todos"
        onConfirm={async () => {
          await ensureOnline().catch((error: unknown) => {
            toast.error(describeError(error));
            throw error;
          });
          await signOut('global');
        }}
      />
    </Card>
  );
}

export function ProfilePage() {
  const { role, settings } = useMember();
  return (
    <Page>
      <PageHeader
        title="Meu perfil"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {settings.company_name} <Badge tone="accent">{ROLE_LABELS[role]}</Badge>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NameForm />
        <div className="space-y-4">
          <PasswordForm />
          <Sessions />
        </div>
      </div>
    </Page>
  );
}
