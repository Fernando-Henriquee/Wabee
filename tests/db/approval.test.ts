import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './env';

/**
 * Aprovação manual de contas: conta nova nasce pendente e não consegue fazer nada até um
 * administrador da plataforma aprovar. Sem depender de e-mail de confirmação.
 */

let env: TestEnv;
let admin: string;
let dono: string;
let companyA: string;

beforeAll(async () => {
  env = await TestEnv.create();
  companyA = await env.defaultCompany();
  dono = await env.createMember('dono@a.test', 'dono', 'Dono');
  admin = await env.createUser('admin@plataforma.test', 'Admin');
  await env.makePlatformAdmin(admin);
});

afterAll(async () => {
  await env.close();
});

describe('aprovação de contas', () => {
  it('conta nova nasce pendente, com o nome da empresa pedida guardado', async () => {
    const nova = await env.createUser('maria@x.test', 'Maria', { pending: true, companyName: 'Oficina da Maria' });
    expect(await env.as(nova, (s) => s.rpc<string>('my_account_status', {}))).toBe('pendente');
    const row = await env.admin().one<{ status: string; display_name: string; requested_company: string }>(
      `select status, display_name, requested_company from public.account_approvals where user_id = $1`, [nova]);
    expect(row).toEqual({ status: 'pendente', display_name: 'Maria', requested_company: 'Oficina da Maria' });
  });

  it('conta que veio de convite do Supabase (invited_at) já nasce aprovada', async () => {
    const id = (await env.admin().one<{ id: string }>(`insert into auth.users (email, invited_at) values ('convidada@x.test', now()) returning id`)).id;
    expect(await env.as(id, (s) => s.rpc<string>('my_account_status', {}))).toBe('aprovado');
  });

  it('conta pendente não cria empresa, não aceita convite e não usa finanças pessoais', async () => {
    const nova = await env.createUser('pendente@x.test', 'Pendente', { pending: true });
    await expect(env.as(nova, (s) => s.rpc('create_company', { p_name: 'Minha empresa' }))).rejects.toThrow(/não foi aprovado/);
    const invite = await env.as(dono, (s) => s.rpc<string>('invite_member', { p_email: 'pendente@x.test' }), { company: companyA });
    expect(await env.as(nova, (s) => s.rpc<unknown[]>('my_pending_invites', {}))).toEqual([]);
    await expect(env.as(nova, (s) => s.rpc('accept_invite', { p_invite_id: invite }))).rejects.toThrow(/não foi aprovado/);
    await expect(env.as(nova, (s) => s.rpc('pf_ensure_space', {}))).rejects.toThrow(/não foi aprovado/);
    // Nada de empresa nenhuma.
    expect(await env.as(nova, (s) => s.rpc<unknown[]>('my_companies', {}))).toEqual([]);
    expect(await env.as(nova, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
  });

  it('só administrador da plataforma vê e decide os cadastros', async () => {
    const nova = await env.createUser('curiosa@x.test', 'Curiosa', { pending: true });
    await expect(env.as(dono, (s) => s.rpc('admin_pending_accounts', {}))).rejects.toThrow(/administrador da plataforma/);
    await expect(env.as(nova, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: true }))).rejects.toThrow(/administrador da plataforma/);
    await expect(env.as(dono, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: true }))).rejects.toThrow(/administrador da plataforma/);
    expect(await env.as(admin, (s) => s.rpc<boolean>('is_platform_admin', {}))).toBe(true);
    expect(await env.as(dono, (s) => s.rpc<boolean>('is_platform_admin', {}))).toBe(false);
    // Ninguém lê as tabelas de aprovação diretamente, só o próprio status.
    expect(await env.as(dono, (s) => s.query(`select * from public.platform_admins`))).toEqual([]);
    const proprio = await env.as(nova, (s) => s.query<{ user_id: string }>(`select user_id from public.account_approvals`));
    expect(proprio.map((r) => r.user_id)).toEqual([nova]);
  });

  it('o administrador vê os pendentes com e-mail e aprova: a conta passa a funcionar', async () => {
    const nova = await env.createUser('aprovar@x.test', 'Para Aprovar', { pending: true, companyName: 'Empresa Nova' });
    const lista = await env.as(admin, (s) =>
      s.rpc<{ pendentes: Array<{ user_id: string; email: string; name: string; company: string }>; decididas: unknown[] }>('admin_pending_accounts', {}));
    const item = lista.pendentes.find((p) => p.user_id === nova);
    expect(item).toMatchObject({ email: 'aprovar@x.test', name: 'Para Aprovar', company: 'Empresa Nova' });

    await env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: true }));
    expect(await env.as(nova, (s) => s.rpc<string>('my_account_status', {}))).toBe('aprovado');
    const empresa = await env.as(nova, (s) => s.rpc<string>('create_company', { p_name: 'Empresa Nova' }));
    expect(empresa).toBeTruthy();

    const depois = await env.as(admin, (s) => s.rpc<{ pendentes: Array<{ user_id: string }>; decididas: Array<{ user_id: string; status: string }> }>('admin_pending_accounts', {}));
    expect(depois.pendentes.some((p) => p.user_id === nova)).toBe(false);
    expect(depois.decididas.find((d) => d.user_id === nova)?.status).toBe('aprovado');
  });

  it('aprovar também confirma o e-mail (a aprovação substitui o link por e-mail)', async () => {
    const nova = await env.createUser('semlink@x.test', 'Sem Link', { pending: true });
    await env.admin().query(`update auth.users set email_confirmed_at = null where id = $1`, [nova]);
    expect((await env.admin().one<{ c: string | null }>(`select email_confirmed_at as c from auth.users where id = $1`, [nova])).c).toBeNull();
    await env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: true }));
    expect((await env.admin().one<{ c: string | null }>(`select email_confirmed_at as c from auth.users where id = $1`, [nova])).c).not.toBeNull();
    // Recusar não confirma nada.
    const outra = await env.createUser('recusada2@x.test', 'Outra', { pending: true });
    await env.admin().query(`update auth.users set email_confirmed_at = null where id = $1`, [outra]);
    await env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: outra, p_approve: false }));
    expect((await env.admin().one<{ c: string | null }>(`select email_confirmed_at as c from auth.users where id = $1`, [outra])).c).toBeNull();
  });

  it('recusar bloqueia a conta; dá para voltar atrás; administrador não é recusado', async () => {
    const nova = await env.createUser('recusar@x.test', 'Recusada', { pending: true });
    await env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: false }));
    expect(await env.as(nova, (s) => s.rpc<string>('my_account_status', {}))).toBe('recusado');
    await expect(env.as(nova, (s) => s.rpc('create_company', { p_name: 'X' }))).rejects.toThrow(/não foi aprovado/);
    await env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: nova, p_approve: true }));
    expect(await env.as(nova, (s) => s.rpc<string>('my_account_status', {}))).toBe('aprovado');
    await expect(env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: admin, p_approve: false }))).rejects.toThrow(/administrador/);
    await expect(env.as(admin, (s) => s.rpc('admin_decide_account', { p_user_id: crypto.randomUUID(), p_approve: true }))).rejects.toThrow(/não encontrado/);
  });

  it('anon não acessa nada', async () => {
    await expect(env.anon((s) => s.rpc('my_account_status', {}))).rejects.toThrow(/permission denied/);
    await expect(env.anon((s) => s.rpc('admin_pending_accounts', {}))).rejects.toThrow(/permission denied/);
  });
});
