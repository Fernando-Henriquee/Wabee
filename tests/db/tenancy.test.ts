import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, TestEnv } from './env';

/**
 * Multi-empresa (SaaS): cada empresa é um espaço isolado. Quem não é membro não vê nem altera nada,
 * mesmo adivinhando ids; convites só partem do dono; as proteções valem também para tabelas futuras.
 */

let env: TestEnv;
let companyA: string;
let companyB: string;
let ana: string; // dono da A
let bia: string; // membro da A
let beto: string; // dono da B
let carla: string; // sem empresa
let itemA: number;
let supplierA: number;
let customerA: number;

const rid = () => crypto.randomUUID();

beforeAll(async () => {
  env = await TestEnv.create();
  companyA = await env.defaultCompany();
  ana = await env.createMember('ana@a.test', 'dono', 'Ana');
  bia = await env.createMember('bia@a.test', 'membro', 'Bia');
  beto = await env.createUser('beto@b.test', 'Beto');
  companyB = await env.createCompany(beto, 'Empresa B');
  carla = await env.createUser('carla@c.test', 'Carla');

  await env.as(ana, async (s) => {
    itemA = await s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Ímã da A', sku: 'IMA-1' } });
    supplierA = await s.rpc<number>('save_supplier', { p_supplier: { name: 'Fornecedor da A', kind: 'LOJA_ONLINE' } });
    customerA = await s.rpc<number>('save_customer', { p_customer: { name: 'Cliente da A' } });
  });
});

afterAll(async () => {
  await env.close();
});

describe('proteções estruturais', () => {
  it('toda tabela do public tem company_id, RLS forçada e políticas (exceto as listadas)', async () => {
    const livres = ['companies', 'company_members', 'company_invites', 'profiles', 'account_approvals', 'platform_admins'];
    const rows = await env.admin().query<{ relname: string; has_company: boolean; rls: boolean; forced: boolean; policies: number }>(`
      select c.relname,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped) as has_company,
             c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname in ('tenant_select', 'tenant_write')) as policies
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and c.relname not like 'pf\\_%' escape '\\'
        and c.relname <> all ($1)
      order by 1`, [livres]);
    expect(rows.length).toBeGreaterThan(40);
    const problemas = rows.filter((r) => !r.has_company || !r.rls || !r.forced || r.policies !== 2).map((r) => r.relname);
    expect(problemas).toEqual([]);
  });

  it('tabelas, views e funções pertencem a wabee_owner (que não ignora RLS)', async () => {
    const owner = await env.admin().one<{ rolbypassrls: boolean; rolsuper: boolean }>(`select rolbypassrls, rolsuper from pg_roles where rolname = 'wabee_owner'`);
    expect(owner).toEqual({ rolbypassrls: false, rolsuper: false });
    const tabelas = await env.admin().query<{ obj: string }>(`
      select c.relname as obj from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and pg_get_userbyid(c.relowner) <> 'wabee_owner'`);
    expect(tabelas).toEqual([]);
    const funcoes = await env.admin().query<{ obj: string }>(`
      select p.proname as obj from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f'
        and pg_get_userbyid(p.proowner) <> 'wabee_owner'
        and p.proname not in ('apply_grants', 'apply_ownership', 'auth_email', 'auth_user_id', 'auth_confirm_email')`);
    expect(funcoes).toEqual([]);
  });

  it('auth.users só é lido por funções do postgres: wabee_owner não vê nenhuma conta', async () => {
    const dono = await env.admin().one<{ n: number }>(`select count(*)::int n from auth.users`);
    expect(dono.n).toBeGreaterThan(0);
    await env.db.exec('set role wabee_owner');
    try {
      expect((await env.db.query<{ n: number }>(`select count(*)::int n from auth.users`)).rows[0]!.n).toBe(0);
    } finally {
      await env.db.exec('reset role');
    }
    const helpers = await env.admin().query<{ proname: string; dono: string; exec: boolean }>(
      `select proname, pg_get_userbyid(proowner) as dono, has_function_privilege('authenticated', oid, 'EXECUTE') as exec
         from pg_proc where pronamespace = 'private'::regnamespace and proname in ('auth_email', 'auth_user_id', 'auth_confirm_email') order by 1`,
    );
    expect(helpers.map((h) => [h.proname, h.dono !== 'wabee_owner', h.exec])).toEqual([['auth_confirm_email', true, false], ['auth_email', true, false], ['auth_user_id', true, false]]);
  });

  it('app_members (compatibilidade com o app antigo) mostra só o vínculo da própria pessoa', async () => {
    const meu = await env.as(ana, (s) => s.query<{ user_id: string; role: string }>(`select user_id, role from public.app_members`));
    expect(meu).toEqual([{ user_id: ana, role: 'dono' }]);
    expect((await env.as(bia, (s) => s.query<{ role: string }>(`select role from public.app_members`))).map((r) => r.role)).toEqual(['leitura']);
    expect(await env.as(carla, (s) => s.query(`select * from public.app_members`))).toEqual([]);
    await expect(env.anon((s) => s.query(`select * from public.app_members`))).rejects.toThrow(/permission denied/);
  });

  it('anon não acessa nada de empresa', async () => {
    await expect(env.anon((s) => s.query(`select * from public.items`))).rejects.toThrow(/permission denied/);
    await expect(env.anon((s) => s.rpc('my_companies', {}))).rejects.toThrow(/permission denied/);
  });
});

describe('isolamento entre empresas', () => {
  it('a empresa B não vê nenhum dado da A (tabelas e views)', async () => {
    for (const table of ['items', 'suppliers', 'customers', 'v_items', 'v_customers', 'stock_balances']) {
      expect(await env.as(beto, (s) => s.query(`select * from public.${table}`)), table).toEqual([]);
    }
    // A auditoria da B não traz nada da A (o item "IMA-1" foi criado na A).
    const auditoriaB = await env.as(beto, (s) => s.query<{ object_ref: string | null }>(`select object_ref from public.v_audit_logs`));
    expect(auditoriaB.some((l) => l.object_ref === 'IMA-1')).toBe(false);
    expect((await env.as(ana, (s) => s.query<{ object_ref: string | null }>(`select object_ref from public.v_audit_logs`))).some((l) => l.object_ref === 'IMA-1')).toBe(true);
    expect((await env.as(ana, (s) => s.query(`select * from public.items`))).length).toBeGreaterThan(0);
  });

  it('com o id da A em mãos, a B não lê, não altera e não referencia nada', async () => {
    const tenta = (fn: (s: Session) => Promise<unknown>) => env.as(beto, async (s) => fn(s));
    await expect(tenta((s) => s.rpc('save_item', { p_item: { id: itemA, kind: 'COMPONENT', name: 'Sequestrado' } }))).rejects.toThrow(/não encontrado/);
    await expect(tenta((s) => s.rpc('save_supplier', { p_supplier: { id: supplierA, name: 'Sequestrado', kind: 'LOJA_ONLINE' } }))).rejects.toThrow();
    await expect(tenta((s) => s.rpc('save_customer', { p_customer: { id: customerA, name: 'Sequestrado' } }))).rejects.toThrow();
    await expect(tenta((s) => s.rpc('set_item_photo', { p_item_id: itemA, p_path: null }))).rejects.toThrow(/não encontrado/);
    await expect(
      tenta((s) => s.rpc('register_opening_balance', { p_request_id: rid(), p_item_id: itemA, p_entries: [{ qty: 1, unit_cost: 1 }] })),
    ).rejects.toThrow();
    const nomes = await env.admin().query<{ name: string }>(`select name from public.items where id = $1`, [itemA]);
    expect(nomes).toEqual([{ name: 'Ímã da A' }]);
  });

  it('chave estrangeira não aceita apontar para dado de outra empresa', async () => {
    await expect(
      env.admin().query(
        `insert into public.items (company_id, sku, name, kind, unit, default_supplier_id) values ($1, 'B-FK', 'Item da B', 'COMPONENT', 'UN', $2)`,
        [companyB, supplierA],
      ),
    ).rejects.toThrow(/foreign key|violates/);
  });

  it('numeração, SKU, configurações e dados iniciais são por empresa', async () => {
    await env.as(beto, async (s) => {
      const sku = await s.rpc<number>('save_item', { p_item: { kind: 'COMPONENT', name: 'Ímã da B', sku: 'IMA-1' } });
      expect(sku).toBeGreaterThan(0);
      expect(await s.query(`select * from public.settings`)).toHaveLength(1);
      expect((await s.one<{ company_name: string }>(`select company_name from public.settings`)).company_name).toBe('Empresa B');
      expect((await s.query(`select 1 from public.financial_categories`)).length).toBeGreaterThan(40);
      expect((await s.query(`select 1 from public.sales_channels`)).length).toBe(5);
    });
    const numero = (user: string) =>
      env.as(user, async (s) => {
        const id = await s.rpc<number>('save_quote', { p_quote: { item_wanted: 'Teste de numeração' } });
        return (await s.one<{ number: string }>(`select number from public.v_quotes where id = $1`, [id])).number;
      });
    expect(await numero(ana)).toMatch(/^ORC-\d{4}-0001$/);
    expect(await numero(beto)).toMatch(/^ORC-\d{4}-0001$/);
  });

  it('o reset de uma empresa não apaga a outra', async () => {
    await env.as(beto, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }));
    expect((await env.as(beto, (s) => s.query(`select * from public.items`))).length).toBe(0);
    expect((await env.as(ana, (s) => s.query(`select * from public.items`))).length).toBeGreaterThan(0);
  });

  it('só dono reseta; membro e quem não é da empresa não', async () => {
    await expect(env.as(bia, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }))).rejects.toThrow();
    await expect(env.as(carla, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }))).rejects.toThrow(/permissão/);
  });
});

describe('várias empresas na mesma conta', () => {
  it('a empresa ativa vem do cabeçalho; sem cabeçalho e com duas empresas, nada é acessível', async () => {
    await env.admin().query(`insert into public.company_members (company_id, user_id, role) values ($1, $2, 'membro')`, [companyB, bia]);
    const mine = await env.as(bia, (s) => s.rpc<Array<{ id: string; role: string }>>('my_companies', {}));
    expect(mine.map((c) => c.id).sort()).toEqual([companyA, companyB].sort());
    expect((await env.as(bia, (s) => s.query(`select * from public.items`), { company: companyA })).length).toBeGreaterThan(0);
    expect(await env.as(bia, (s) => s.query(`select * from public.items`), { company: companyB })).toEqual([]);
    expect(await env.as(bia, (s) => s.query(`select * from public.items`))).toEqual([]);
    await expect(env.as(bia, (s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'x' } }))).rejects.toThrow(/permissão/);
  });

  it('cabeçalho com empresa que não é da pessoa não dá acesso', async () => {
    expect(await env.as(carla, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
    await expect(env.as(carla, (s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'x' } }), { company: companyA })).rejects.toThrow(/permissão/);
    expect(await env.as(carla, (s) => s.query(`select * from public.items`), { company: 'não-é-uuid' })).toEqual([]);
  });
});

describe('membros e convites', () => {
  it('v_members mostra só os membros da empresa ativa', async () => {
    const membros = await env.as(ana, (s) => s.query<{ email: string }>(`select email from public.v_members order by email`), { company: companyA });
    expect(membros.map((m) => m.email)).toEqual(['ana@a.test', 'bia@a.test']);
    expect((await env.as(beto, (s) => s.query(`select * from public.v_members`), { company: companyB })).length).toBe(2);
  });

  it('só o dono convida; e-mail inválido e quem já é membro são recusados', async () => {
    await expect(env.as(bia, (s) => s.rpc('invite_member', { p_email: 'novo@c.test' }), { company: companyA })).rejects.toThrow(/dono/);
    await expect(env.as(ana, (s) => s.rpc('invite_member', { p_email: 'sem-arroba' }), { company: companyA })).rejects.toThrow(/e-mail válido/);
    await expect(env.as(ana, (s) => s.rpc('invite_member', { p_email: 'BIA@a.test' }), { company: companyA })).rejects.toThrow(/já faz parte/);
  });

  it('convite aceito vira vínculo de membro; outra pessoa não aceita nem vê o convite', async () => {
    const id = await env.as(ana, (s) => s.rpc<string>('invite_member', { p_email: 'Carla@C.test' }), { company: companyA });
    expect(await env.as(ana, (s) => s.rpc<unknown[]>('list_invites', {}), { company: companyA })).toHaveLength(1);
    expect(await env.as(beto, (s) => s.rpc<unknown[]>('my_pending_invites', {}), { company: companyB })).toEqual([]);
    await expect(env.as(beto, (s) => s.rpc('accept_invite', { p_invite_id: id }), { company: companyB })).rejects.toThrow(/não encontrado/);
    const pend = await env.as(carla, (s) => s.rpc<Array<{ company_name: string }>>('my_pending_invites', {}));
    expect(pend).toHaveLength(1);
    // Antes de aceitar, Carla não vê nada da empresa.
    expect(await env.as(carla, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
    expect(await env.as(carla, (s) => s.rpc<string>('accept_invite', { p_invite_id: id }))).toBe(companyA);
    expect((await env.as(carla, (s) => s.query(`select * from public.items`))).length).toBeGreaterThan(0);
    await expect(env.as(carla, (s) => s.rpc('accept_invite', { p_invite_id: id }))).rejects.toThrow(/já respondido/);
  });

  it('dono cancela convite pendente e a empresa nunca fica sem dono', async () => {
    const id = await env.as(ana, (s) => s.rpc<string>('invite_member', { p_email: 'dani@d.test' }), { company: companyA });
    await env.as(ana, (s) => s.rpc('cancel_invite', { p_invite_id: id }), { company: companyA });
    expect(await env.as(ana, (s) => s.rpc<unknown[]>('list_invites', {}), { company: companyA })).toEqual([]);
    await expect(env.as(ana, (s) => s.rpc('set_member_role', { p_user_id: ana, p_role: 'membro' }), { company: companyA })).rejects.toThrow(/pelo menos um dono/);
    await expect(env.as(ana, (s) => s.rpc('remove_member', { p_user_id: ana }), { company: companyA })).rejects.toThrow(/pelo menos um dono/);
    await expect(env.as(bia, (s) => s.rpc('remove_member', { p_user_id: ana }), { company: companyA })).rejects.toThrow(/dono/);
  });

  it('dono promove e remove membros', async () => {
    await env.as(ana, (s) => s.rpc('set_member_role', { p_user_id: bia, p_role: 'dono' }), { company: companyA });
    await env.as(ana, (s) => s.rpc('set_member_role', { p_user_id: ana, p_role: 'membro' }), { company: companyA });
    await env.as(bia, (s) => s.rpc('remove_member', { p_user_id: carla }), { company: companyA });
    expect(await env.as(carla, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
    await env.as(bia, (s) => s.rpc('set_member_role', { p_user_id: ana, p_role: 'dono' }), { company: companyA });
  });

  it('perfis só aparecem para quem divide empresa', async () => {
    const vistos = await env.as(ana, (s) => s.query<{ id: string }>(`select id from public.profiles`));
    expect(vistos.map((p) => p.id)).toContain(ana);
    expect(vistos.map((p) => p.id)).not.toContain(beto);
  });
});

describe('cadastro aberto (criar conta)', () => {
  it('conta nova não vê nada de nenhuma empresa até criar a própria ou aceitar um convite', async () => {
    const nova = await env.createUser('nova@x.test', 'Nova');
    expect(await env.as(nova, (s) => s.rpc<unknown[]>('my_companies', {}))).toEqual([]);
    for (const table of ['items', 'customers', 'settings', 'company_members', 'companies', 'audit_logs']) {
      expect(await env.as(nova, (s) => s.query(`select * from public.${table}`)), table).toEqual([]);
    }
    expect(await env.as(nova, (s) => s.query(`select * from public.v_members`))).toEqual([]);
    expect(await env.as(nova, (s) => s.query(`select id from public.profiles where id <> $1`, [nova]))).toEqual([]);
    // Mesmo com o id de uma empresa na mão, sem convite não entra.
    expect(await env.as(nova, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
    await expect(env.as(nova, (s) => s.rpc('save_item', { p_item: { kind: 'COMPONENT', name: 'x' } }), { company: companyA })).rejects.toThrow(/permissão/);
    await expect(env.as(nova, (s) => s.rpc('invite_member', { p_email: 'a@b.test' }), { company: companyA })).rejects.toThrow(/dono/);
    // Cria a própria empresa e só enxerga ela.
    const propria = await env.as(nova, (s) => s.rpc<string>('create_company', { p_name: 'Empresa da Nova' }));
    expect((await env.as(nova, (s) => s.rpc<Array<{ id: string; role: string }>>('my_companies', {}))).map((c) => [c.id, c.role])).toEqual([[propria, 'dono']]);
    expect((await env.as(nova, (s) => s.query(`select * from public.items`))).length).toBe(0);
    expect((await env.as(ana, (s) => s.query(`select * from public.items`), { company: companyA })).length).toBeGreaterThan(0);
  });

  it('convite só vale para e-mail confirmado (quem cadastra o e-mail de outra pessoa não entra)', async () => {
    const id = await env.as(ana, (s) => s.rpc<string>('invite_member', { p_email: 'vitima@x.test' }), { company: companyA });
    const impostor = await env.createUser('vitima@x.test', 'Impostor');
    await env.admin().query(`update auth.users set email_confirmed_at = null where id = $1`, [impostor]);
    expect(await env.as(impostor, (s) => s.rpc<unknown[]>('my_pending_invites', {}))).toEqual([]);
    await expect(env.as(impostor, (s) => s.rpc('accept_invite', { p_invite_id: id }))).rejects.toThrow(/não encontrado/);
    expect(await env.as(impostor, (s) => s.query(`select * from public.items`), { company: companyA })).toEqual([]);
    // Depois de confirmar o e-mail (link recebido), o convite aparece e pode ser aceito.
    await env.admin().query(`update auth.users set email_confirmed_at = now() where id = $1`, [impostor]);
    expect(await env.as(impostor, (s) => s.rpc<unknown[]>('my_pending_invites', {}))).toHaveLength(1);
  });

  it('finanças pessoais: só adiciona quem divide empresa e a resposta não revela quem tem conta', async () => {
    const solitaria = await env.createUser('solitaria@x.test', 'Solitária');
    await env.as(ana, (s) => s.rpc('pf_ensure_space', {}));
    const msg = /Não foi possível adicionar essa pessoa/;
    await expect(env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'solitaria@x.test' }))).rejects.toThrow(msg);
    await expect(env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'ninguem-existe@x.test' }))).rejects.toThrow(msg);
    expect(solitaria).toBeTruthy();
  });
});

describe('criar outra empresa', () => {
  it('quem já tem empresa cria uma segunda, com dados iniciais próprios e sem misturar', async () => {
    const segunda = await env.as(beto, (s) => s.rpc<string>('create_company', { p_name: 'Segunda do Beto' }), { company: companyB });
    expect(segunda).not.toBe(companyB);
    const mine = await env.as(beto, (s) => s.rpc<Array<{ id: string }>>('my_companies', {}));
    expect(mine).toHaveLength(2);
    await env.as(beto, async (s) => {
      expect((await s.one<{ company_name: string }>(`select company_name from public.settings`)).company_name).toBe('Segunda do Beto');
      expect((await s.query(`select 1 from public.sales_channels`)).length).toBe(5);
    }, { company: segunda });
    expect((await env.as(beto, (s) => s.one<{ company_name: string }>(`select company_name from public.settings`), { company: companyB })).company_name).toBe('Empresa B');
    // Depois do seed a sessão volta a depender do cabeçalho: sem ele, com duas empresas, nada é acessível.
    expect(await env.as(beto, (s) => s.query(`select * from public.settings`))).toEqual([]);
  });
});

describe('finanças pessoais ficam por conta', () => {
  it('funcionam sem empresa e não vazam entre empresas', async () => {
    await env.as(carla, (s) => s.rpc('pf_ensure_space', {}));
    await env.as(ana, (s) => s.rpc('pf_ensure_space', {}));
    expect(await env.as(carla, (s) => s.query(`select * from public.v_pf_transactions`))).toEqual([]);
  });
});
