import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { n, TestEnv } from './env';

/** Finanças pessoais: isolamento entre pessoas, valor do dia, parcelas, financiamentos e calendário. */

let env: TestEnv;
let ana: string;
let bia: string;
let cris: string;
let producao: string;
let leitura: string;
let conta: number;

const rid = () => crypto.randomUUID();
const day = async (offset: number) => (await env.admin().one<{ d: string }>(`select (private.today() + $1::integer)::text d`, [offset])).d;

interface Budget {
  date: string;
  cycle_start: string;
  cycle_end: string;
  days_left: number;
  balance: number;
  incomes: number;
  commitments: number;
  reserve: number;
  available: number;
  allowance: number;
  spent: number;
  remaining: number;
  tomorrow_if_save: number | null;
  tomorrow_if_spend: number | null;
  next_bills: Array<{ schedule_id: number; name: string; due_date: string; amount: number; overdue: boolean }>;
  overdue_count: number;
}

const budget = (user: string, date?: string) => env.as(user, (s) => s.rpc<Budget>('pf_budget', { p_date: date ?? null }));
const add = (user: string, tx: Record<string, unknown> | Array<Record<string, unknown>>) => env.as(user, (s) => s.rpc<{ ids: number[] }>('pf_add_transaction', { p_request_id: rid(), p_txs: tx }));
const plan = (user: string, p: Record<string, unknown>) => env.as(user, (s) => s.rpc<number>('pf_save_plan', { p_plan: p }));
/** Limpa tabelas entre os testes (vários comandos, por isso db.exec). */
const wipe = (...tables: string[]) => env.db.exec(tables.map((t) => `delete from public.${t};`).join(' '));
const rows = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => env.as(user, (s) => s.query<T>(sql, params));

/** Escolhe um dia de salário que deixa ontem e anteontem no mesmo ciclo de hoje e ainda sobrem pelo menos 3 dias. */
async function pickCycle(user: string) {
  const back = await day(-2);
  for (let start = 1; start <= 28; start++) {
    await env.as(user, (s) => s.rpc('pf_save_settings', { p_settings: { cycle_start_day: start } }));
    const now = await budget(user);
    const past = await budget(user, back);
    if (now.days_left >= 3 && past.cycle_end === now.cycle_end) return start;
  }
  throw new Error('Nenhum dia de salário serve para o teste');
}

beforeAll(async () => {
  env = await TestEnv.create();
  ana = await env.createMember('ana@wabee.test', 'dono');
  bia = await env.createMember('bia@wabee.test', 'dono');
  cris = await env.createMember('cris@wabee.test', 'dono');
  producao = await env.createMember('producao@wabee.test', 'producao');
  leitura = await env.createMember('leitura@wabee.test', 'leitura');
  await env.as(ana, async (s) => {
    await s.rpc('pf_ensure_space', {});
    conta = (await s.one<{ id: number }>(`select id from public.pf_accounts limit 1`)).id;
    // Saldo de 3.000 há cinco dias.
    await s.rpc('pf_save_account', { p_account: { id: conta, name: 'Conta principal', kind: 'CONTA', opening_balance: 3000, opening_date: await day(-5) } });
  });
  await pickCycle(ana);
});

afterAll(async () => {
  await env.close();
});

describe('espaço e privacidade', () => {
  it('cria o espaço com categorias e uma conta, uma única vez', async () => {
    const again = await env.as(ana, (s) => s.rpc<number>('pf_ensure_space', {}));
    const spaces = await env.admin().query(`select 1 from public.pf_spaces`);
    expect(spaces.length).toBe(1);
    expect(again).toBeGreaterThan(0);
    const cats = await rows<{ name: string; kind: string }>(ana, `select name, kind from public.pf_categories order by kind, name`);
    expect(cats.map((c) => c.name)).toContain('Mercado');
    expect(cats.filter((c) => c.kind === 'ENTRADA').map((c) => c.name).sort()).toEqual(['Extra', 'Salário']);
  });

  it('produção e leitura não usam a aba pessoal', async () => {
    await expect(env.as(producao, (s) => s.rpc('pf_ensure_space', {}))).rejects.toThrow(/permissão/);
    await expect(env.as(leitura, (s) => s.rpc('pf_ensure_space', {}))).rejects.toThrow(/permissão/);
    expect(await rows(producao, `select * from public.pf_transactions`)).toEqual([]);
    expect(await rows(leitura, `select * from public.v_pf_transactions`)).toEqual([]);
  });

  it('outro dono sem convite não vê nada e é mandado abrir o próprio espaço', async () => {
    await add(ana, { amount: 10, description: 'segredo da Ana' });
    expect(await rows(bia, `select * from public.v_pf_transactions`)).toEqual([]);
    expect(await rows(bia, `select * from public.pf_accounts`)).toEqual([]);
    await expect(budget(bia)).rejects.toThrow(/Abra a aba Pessoal/);
  });

  it('o convite só vale para dono ativo que não está em outro espaço, e o espaço comporta duas pessoas', async () => {
    await expect(env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'producao@wabee.test' }))).rejects.toThrow(/perfil Dono/);
    await expect(env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'ninguem@wabee.test' }))).rejects.toThrow(/perfil Dono/);
    await env.as(cris, (s) => s.rpc('pf_ensure_space', {}));
    await expect(env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'cris@wabee.test' }))).rejects.toThrow(/já usa um espaço/);
    await env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'bia@wabee.test' }));
    const seen = await rows<{ description: string }>(bia, `select description from public.v_pf_transactions`);
    expect(seen.map((t) => t.description)).toContain('segredo da Ana');
    const members = await env.as(bia, (s) => s.rpc<Array<{ display_name: string; is_me: boolean }>>('pf_members', {}));
    expect(members).toHaveLength(2);
    expect(members.filter((m) => m.is_me)).toHaveLength(1);
    // Cris continua isolada das duas.
    expect(await rows(cris, `select * from public.v_pf_transactions`)).toEqual([]);
  });

  it('a segunda pessoa lança nos mesmos dados e dá para sair do espaço', async () => {
    await add(bia, { amount: 5, description: 'lançado pela Bia' });
    expect((await rows<{ description: string }>(ana, `select description from public.v_pf_transactions`)).map((t) => t.description)).toContain('lançado pela Bia');
    await env.as(bia, (s) => s.rpc('pf_remove_member', { p_user_id: bia }));
    expect(await rows(bia, `select * from public.v_pf_transactions`)).toEqual([]);
    await expect(env.as(ana, (s) => s.rpc('pf_remove_member', { p_user_id: ana }))).rejects.toThrow(/única pessoa/);
    await env.as(ana, (s) => s.rpc('pf_add_member', { p_email: 'bia@wabee.test' }));
    await wipe('pf_transactions');
  });
});

describe('lançamentos', () => {
  it('recusa data futura, data antes do saldo inicial, categoria do tipo errado e transferência para a mesma conta', async () => {
    await expect(add(ana, { amount: 10, date: await day(1) })).rejects.toThrow(/não pode ser futura/);
    await expect(add(ana, { amount: 10, date: await day(-30) })).rejects.toThrow(/anterior ao saldo inicial/);
    const salario = (await rows<{ id: number }>(ana, `select id from public.pf_categories where name = 'Salário'`))[0]!.id;
    await expect(add(ana, { amount: 10, category_id: salario })).rejects.toThrow(/não serve para gasto/);
    await expect(add(ana, { kind: 'TRANSFERENCIA', amount: 10, account_id: conta, to_account_id: conta })).rejects.toThrow(/destino diferente/);
    await expect(add(ana, { amount: 0 })).rejects.toThrow(/maior que zero/);
  });

  it('o mesmo envio feito duas vezes grava uma vez, e uma frase com vários gastos grava todos', async () => {
    const key = rid();
    const tx = { amount: 12.5, description: 'padaria' };
    await env.as(ana, (s) => s.rpc('pf_add_transaction', { p_request_id: key, p_txs: tx }));
    await env.as(ana, (s) => s.rpc('pf_add_transaction', { p_request_id: key, p_txs: tx }));
    expect((await rows(ana, `select 1 from public.pf_transactions where description = 'padaria'`)).length).toBe(1);
    const many = await add(ana, [{ amount: 20, description: 'pão', source: 'VOZ', transcript: 'vinte no pão e cinquenta de uber' }, { amount: 50, description: 'uber', source: 'VOZ' }]);
    expect(many.ids).toHaveLength(2);
    await wipe('pf_transactions');
  });

  it('edita e apaga lançamentos', async () => {
    const { ids } = await add(ana, { amount: 30, description: 'errado' });
    await env.as(ana, (s) => s.rpc('pf_update_transaction', { p_id: ids[0], p_tx: { amount: 33, description: 'certo' } }));
    expect((await rows<{ amount: number; description: string }>(ana, `select amount, description from public.pf_transactions where id = $1`, [ids[0]]))[0]).toMatchObject({ description: 'certo' });
    await env.as(ana, (s) => s.rpc('pf_delete_transaction', { p_id: ids[0] }));
    expect(await rows(ana, `select 1 from public.pf_transactions where id = $1`, [ids[0]])).toEqual([]);
    await expect(env.as(ana, (s) => s.rpc('pf_delete_transaction', { p_id: ids[0] }))).rejects.toThrow(/não encontrado/);
  });
});

describe('valor que pode gastar por dia', () => {
  it('divide o que tem pelos dias até o fim do ciclo', async () => {
    const b = await budget(ana);
    expect(n(b.balance)).toBe(3000);
    expect(n(b.available)).toBe(3000);
    expect(n(b.allowance)).toBe(Math.round((3000 / b.days_left) * 100) / 100);
    expect(n(b.spent)).toBe(0);
    expect(n(b.remaining)).toBe(n(b.allowance));
  });

  it('o que não foi gasto ontem sobe o limite de hoje e o de amanhã mostra os dois cenários', async () => {
    const today = await budget(ana);
    const yesterday = await budget(ana, await day(-1));
    const before = await budget(ana, await day(-2));
    expect(before.cycle_end).toBe(today.cycle_end);
    // Sem gastar nada, cada dia seguinte divide os mesmos 3.000 por menos dias.
    expect(n(today.allowance)).toBeGreaterThan(n(yesterday.allowance));
    expect(n(yesterday.allowance)).toBeGreaterThan(n(before.allowance));
    expect(n(today.tomorrow_if_save)).toBeCloseTo(3000 / (today.days_left - 1), 2);
    expect(n(today.tomorrow_if_spend)).toBeCloseTo((3000 - n(today.allowance)) / (today.days_left - 1), 2);
  });

  it('gastar hoje reduz o que resta hoje e o limite dos próximos dias', async () => {
    const start = await budget(ana);
    await add(ana, { amount: 100, description: 'mercado' });
    const b = await budget(ana);
    expect(n(b.spent)).toBe(100);
    expect(n(b.allowance)).toBe(n(start.allowance));
    expect(n(b.remaining)).toBeCloseTo(n(start.allowance) - 100, 2);
    expect(n(b.tomorrow_if_save)).toBeCloseTo(2900 / (b.days_left - 1), 2);
    await wipe('pf_transactions');
  });

  it('gastar ontem derruba o limite de hoje', async () => {
    const start = await budget(ana);
    await add(ana, { amount: 600, date: await day(-1), description: 'conserto' });
    const b = await budget(ana);
    expect(n(b.balance)).toBe(2400);
    expect(n(b.allowance)).toBeLessThan(n(start.allowance));
    expect(n(b.allowance)).toBeCloseTo(2400 / b.days_left, 2);
    await wipe('pf_transactions');
  });

  it('a reserva do ciclo sai do que está disponível', async () => {
    await env.as(ana, (s) => s.rpc('pf_save_settings', { p_settings: { cycle_reserve: 600 } }));
    const b = await budget(ana);
    expect(n(b.available)).toBe(2400);
    await env.as(ana, (s) => s.rpc('pf_save_settings', { p_settings: { cycle_reserve: 0 } }));
  });

  it('entrada prevista até o fim do ciclo aumenta o disponível; recebida, também', async () => {
    const start = await budget(ana);
    const salary = await plan(ana, { kind: 'ENTRADA_FIXA', name: 'Salário', amount: 1000, first_due: start.cycle_end });
    expect(n((await budget(ana)).available)).toBe(4000);
    const item = (await rows<{ id: number }>(ana, `select id from public.v_pf_schedule where plan_id = $1 order by due_date limit 1`, [salary]))[0]!;
    await env.as(ana, (s) => s.rpc('pf_pay_schedule', { p_schedule_id: item.id }));
    // Recebido hoje: entra pelo lançamento, sem contar duas vezes.
    expect(n((await budget(ana)).available)).toBe(4000);
    expect(n((await budget(ana, await day(1))).balance)).toBe(4000);
    await env.as(ana, (s) => s.rpc('pf_close_plan', { p_plan_id: salary }));
    await env.as(ana, (s) => s.rpc('pf_unpay_schedule', { p_schedule_id: item.id }));
    await wipe('pf_transactions', 'pf_schedule', 'pf_plans');
  });
});

describe('parcelas e contas fixas', () => {
  it('parcela que vence no ciclo é compromisso; pagar não conta como gasto do dia nem muda o disponível', async () => {
    const start = await budget(ana);
    const p = await plan(ana, { kind: 'PARCELADO', name: 'Tênis', amount: 100, installments_total: 3, first_due: await day(1), account_id: conta });
    const planned = await budget(ana);
    // Só a parcela que vence até o fim do ciclo entra; as dos meses seguintes entram quando o ciclo chegar.
    expect(n(planned.commitments)).toBe(100);
    expect(n(planned.available)).toBe(n(start.available) - 100);
    const first = (await rows<{ id: number; number: number }>(ana, `select id, number from public.v_pf_schedule where plan_id = $1 order by number`, [p]))[0]!;
    await env.as(ana, (s) => s.rpc('pf_pay_schedule', { p_schedule_id: first.id }));
    const paid = await budget(ana);
    expect(n(paid.spent)).toBe(0);
    expect(n(paid.available)).toBe(n(planned.available));
    expect(n(paid.commitments)).toBe(100);
    const tx = (await rows<{ description: string; schedule_id: number }>(ana, `select description, schedule_id from public.pf_transactions`))[0]!;
    expect(tx).toMatchObject({ description: 'Tênis (1/3)', schedule_id: first.id });
    // Amanhã: o dinheiro já saiu da conta e não resta compromisso neste ciclo.
    const tomorrow = await budget(ana, await day(1));
    expect(n(tomorrow.balance)).toBe(2900);
    expect(n(tomorrow.commitments)).toBe(0);
    await expect(env.as(ana, (s) => s.rpc('pf_pay_schedule', { p_schedule_id: first.id }))).rejects.toThrow(/já foi pago/);
    // Desfazer devolve a parcela a "prevista" e apaga o lançamento.
    await env.as(ana, (s) => s.rpc('pf_unpay_schedule', { p_schedule_id: first.id }));
    expect(await rows(ana, `select 1 from public.pf_transactions`)).toEqual([]);
    expect(n((await budget(ana)).commitments)).toBe(100);
    // Mudar o valor muda o compromisso; pular tira do cálculo.
    await env.as(ana, (s) => s.rpc('pf_set_schedule_amount', { p_schedule_id: first.id, p_amount: 150 }));
    expect(n((await budget(ana)).commitments)).toBe(150);
    await env.as(ana, (s) => s.rpc('pf_skip_schedule', { p_schedule_id: first.id }));
    expect(n((await budget(ana)).commitments)).toBe(0);
    await wipe('pf_transactions', 'pf_schedule', 'pf_plans');
  });

  it('apagar o lançamento que pagou a parcela volta a parcela para prevista', async () => {
    const p = await plan(ana, { kind: 'PARCELADO', name: 'Fone', amount: 80, installments_total: 2, first_due: await day(2), account_id: conta });
    const item = (await rows<{ id: number }>(ana, `select id from public.v_pf_schedule where plan_id = $1 and number = 1`, [p]))[0]!;
    const txId = await env.as(ana, (s) => s.rpc<number>('pf_pay_schedule', { p_schedule_id: item.id, p_amount: 85 }));
    expect((await rows<{ status: string; amount: number }>(ana, `select status, amount from public.v_pf_schedule where id = $1`, [item.id]))[0]).toMatchObject({ status: 'PAGO' });
    await env.as(ana, (s) => s.rpc('pf_delete_transaction', { p_id: txId }));
    expect((await rows<{ status: string }>(ana, `select status from public.v_pf_schedule where id = $1`, [item.id]))[0]!.status).toBe('PREVISTO');
    await wipe('pf_transactions', 'pf_schedule', 'pf_plans');
  });

  it('parcela atrasada continua como compromisso e aparece no aviso', async () => {
    await plan(ana, { kind: 'PARCELADO', name: 'Geladeira', amount: 200, installments_total: 2, first_due: await day(-3), account_id: conta });
    const b = await budget(ana);
    // A atrasada conta; a do mês seguinte só entra quando o ciclo chegar nela.
    expect(n(b.commitments)).toBe(200);
    expect(b.overdue_count).toBe(1);
    expect(b.next_bills[0]).toMatchObject({ name: 'Geladeira', overdue: true });
    await wipe('pf_schedule', 'pf_plans');
  });

  it('parcelas já pagas antes de cadastrar não mexem no saldo nem nos compromissos', async () => {
    const p = await plan(ana, { kind: 'PARCELADO', name: 'Sofá', amount: 100, installments_total: 4, first_due: await day(-70), paid_count: 3, account_id: conta });
    const st = await rows<{ status: string }>(ana, `select status from public.v_pf_schedule where plan_id = $1 order by number`, [p]);
    expect(st.map((r) => r.status)).toEqual(['PAGO', 'PAGO', 'PAGO', 'PREVISTO']);
    const b = await budget(ana);
    expect(n(b.balance)).toBe(3000);
    const next = (await rows<{ due_date: Date }>(ana, `select due_date from public.v_pf_schedule where plan_id = $1 and status = 'PREVISTO'`, [p]))[0]!.due_date;
    expect(n(b.commitments)).toBe(next.toISOString().slice(0, 10) <= b.cycle_end ? 100 : 0);
    await wipe('pf_schedule', 'pf_plans');
  });

  it('conta fixa gera os vencimentos futuros sem duplicar e encerrar apaga os futuros', async () => {
    const p = await plan(ana, { kind: 'CONTA_FIXA', name: 'Internet', amount: 120, first_due: await day(3), account_id: conta });
    const first = await rows(ana, `select 1 from public.v_pf_schedule where plan_id = $1`, [p]);
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(await env.as(ana, (s) => s.rpc<number>('pf_sync', {}))).toBe(0);
    await env.as(ana, (s) => s.rpc('pf_save_plan', { p_plan: { id: p, name: 'Internet fibra', amount: 130, account_id: conta } }));
    const amounts = await rows<{ amount: number }>(ana, `select distinct amount from public.v_pf_schedule where plan_id = $1`, [p]);
    expect(amounts.map((a) => n(a.amount))).toEqual([130]);
    await env.as(ana, (s) => s.rpc('pf_close_plan', { p_plan_id: p }));
    expect(await rows(ana, `select 1 from public.v_pf_schedule where plan_id = $1`, [p])).toEqual([]);
    await wipe('pf_schedule', 'pf_plans');
  });
});

describe('financiamento', () => {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

  it('Price: parcela fixa, juros decrescentes e saldo devedor zerado na última', async () => {
    const p = await plan(ana, { kind: 'FINANCIAMENTO', name: 'Carro', lender: 'Banco X', principal: 10000, rate_month: 0.01, installments_total: 12, system: 'PRICE', first_due: await day(10), account_id: conta });
    const s = await rows<{ amount: number; interest: number }>(ana, `select amount, interest from public.v_pf_schedule where plan_id = $1 order by number`, [p]);
    expect(s).toHaveLength(12);
    expect(n(s[0]!.amount)).toBe(888.49);
    expect(n(s[0]!.interest)).toBe(100);
    expect(n(s[1]!.interest)).toBeLessThan(n(s[0]!.interest));
    const amortized = sum(s.map((r) => n(r.amount) - n(r.interest)));
    expect(amortized).toBeCloseTo(10000, 2);
    const view = (await rows<Record<string, number | string>>(ana, `select * from public.v_pf_plans where id = $1`, [p]))[0]!;
    expect(n(view.total_interest as number)).toBeCloseTo(sum(s.map((r) => n(r.interest))), 2);
    expect(n(view.outstanding_principal as number)).toBe(10000);
    expect(view.open_count).toBe(12);
    await wipe('pf_schedule', 'pf_plans');
  });

  it('SAC: amortização fixa e parcelas decrescentes', async () => {
    const p = await plan(ana, { kind: 'FINANCIAMENTO', name: 'Apartamento', principal: 12000, rate_month: 0.01, installments_total: 12, system: 'SAC', first_due: await day(10) });
    const s = await rows<{ amount: number; interest: number }>(ana, `select amount, interest from public.v_pf_schedule where plan_id = $1 order by number`, [p]);
    expect(n(s[0]!.amount)).toBe(1120); // 1.000 de amortização + 120 de juros
    expect(n(s[11]!.amount)).toBeCloseTo(1010, 2);
    expect(sum(s.map((r) => n(r.amount) - n(r.interest)))).toBeCloseTo(12000, 2);
    await wipe('pf_schedule', 'pf_plans');
  });

  it('valor fixo informado e parcelas já pagas reduzem o saldo devedor', async () => {
    const p = await plan(ana, { kind: 'FINANCIAMENTO', name: 'Moto', principal: 6000, rate_month: 0.02, installments_total: 12, system: 'PRICE', first_due: await day(-90), paid_count: 3, account_id: conta });
    const view = (await rows<Record<string, number>>(ana, `select * from public.v_pf_plans where id = $1`, [p]))[0]!;
    expect(view.paid_count).toBe(3);
    expect(view.open_count).toBe(9);
    expect(n(view.outstanding_principal)).toBeLessThan(6000);
    expect(n(view.outstanding_principal)).toBeGreaterThan(4000);
    const fixed = await plan(ana, { kind: 'FINANCIAMENTO', name: 'Consórcio', principal: 1000, installments_total: 10, system: 'FIXA', amount: 110, first_due: await day(10) });
    const amounts = await rows<{ amount: number; interest: number | null }>(ana, `select amount, interest from public.v_pf_schedule where plan_id = $1`, [fixed]);
    expect(amounts.every((a) => n(a.amount) === 110 && a.interest === null)).toBe(true);
    await expect(plan(ana, { kind: 'FINANCIAMENTO', name: 'Sem valor', principal: 1000, installments_total: 10, system: 'FIXA', first_due: await day(10) })).rejects.toThrow(/valor da parcela/);
    await wipe('pf_schedule', 'pf_plans');
  });
});

describe('contas e transferências', () => {
  it('guardar numa poupança tira do disponível; o cartão com saldo negativo reduz o que se pode gastar', async () => {
    const savings = await env.as(ana, (s) => s.rpc<number>('pf_save_account', { p_account: { name: 'Poupança', kind: 'POUPANCA', opening_balance: 500, opening_date: undefined } }));
    expect((await rows<{ in_budget: boolean }>(ana, `select in_budget from public.pf_accounts where id = $1`, [savings]))[0]!.in_budget).toBe(false);
    const start = await budget(ana);
    await add(ana, { kind: 'TRANSFERENCIA', amount: 200, account_id: conta, to_account_id: savings });
    expect(n((await budget(ana, await day(1))).balance)).toBe(n(start.balance) - 200);
    const card = await env.as(ana, (s) => s.rpc<number>('pf_save_account', { p_account: { name: 'Cartão', kind: 'CARTAO', opening_balance: -400 } }));
    expect(n((await budget(ana)).balance)).toBe(n(start.balance) - 400);
    // Pagar a fatura: transferência da conta para o cartão, sem mudar o total.
    const before = n((await budget(ana, await day(1))).balance);
    await add(ana, { kind: 'TRANSFERENCIA', amount: 400, account_id: conta, to_account_id: card });
    expect(n((await budget(ana, await day(1))).balance)).toBe(before);
    await wipe('pf_transactions');
  });
});

describe('calendário', () => {
  it('traz um item por dia com o gasto, o limite do dia e os vencimentos', async () => {
    await add(ana, { amount: 40, date: await day(-1), description: 'ontem' });
    await add(ana, { amount: 25, description: 'hoje' });
    const p = await plan(ana, { kind: 'PARCELADO', name: 'Curso', amount: 90, installments_total: 2, first_due: await day(1), account_id: conta });
    const cal = await env.as(ana, (s) => s.rpc<{ today: string; days: Array<{ date: string; is_future: boolean; spent: number; allowance: number | null; bills: Array<{ name: string }> }> }>('pf_calendar', {}));
    const byDate = new Map(cal.days.map((d) => [d.date, d]));
    expect(byDate.get(await day(-1))).toMatchObject({ spent: 40, is_future: false });
    expect(byDate.get(cal.today)).toMatchObject({ spent: 25, is_future: false });
    expect(n(byDate.get(cal.today)!.allowance!)).toBeGreaterThan(0);
    const tomorrow = byDate.get(await day(1));
    // Se o mês termina hoje, amanhã não está na lista.
    if (tomorrow) expect(tomorrow.bills.map((b) => b.name)).toContain('Curso');
    expect(cal.days.length).toBeGreaterThanOrEqual(28);
    expect(p).toBeGreaterThan(0);
    await wipe('pf_transactions', 'pf_schedule', 'pf_plans');
  });

  it('o resumo soma por categoria', async () => {
    const mercado = (await rows<{ id: number }>(ana, `select id from public.pf_categories where name = 'Mercado'`))[0]!.id;
    await add(ana, { amount: 70, category_id: mercado });
    await add(ana, { amount: 30 });
    const from = await day(-5);
    const to = await day(0);
    const summary = await env.as(ana, (s) => s.rpc<{ spent: number; by_category: Array<{ name: string; total: number }> }>('pf_summary', { p_from: from, p_to: to }));
    expect(n(summary.spent)).toBe(100);
    expect(summary.by_category.map((c) => c.name)).toEqual(['Mercado', 'Sem categoria']);
    await wipe('pf_transactions');
  });
});

describe('palavras aprendidas', () => {
  it('guarda a palavra sem acento, conta os usos e troca a categoria quando o dono corrige', async () => {
    const cat = async (name: string) => (await rows<{ id: number }>(ana, `select id from public.pf_categories where name = $1`, [name]))[0]!.id;
    const lazer = await cat('Lazer');
    const fora = await cat('Alimentação fora');
    expect(await env.as(ana, (s) => s.rpc<number>('pf_learn_words', { p_rules: [{ word: ' Pizzaria ', category_id: fora }, { word: 'x', category_id: fora }, { word: 'boliche', category_id: lazer }] }))).toBe(2);
    await env.as(ana, (s) => s.rpc('pf_learn_words', { p_rules: [{ word: 'pizzaria', category_id: fora }] }));
    const pizza = (await rows<{ uses: number; category_id: number }>(ana, `select uses, category_id from public.pf_word_rules where word = 'pizzaria'`))[0]!;
    expect(pizza).toMatchObject({ uses: 2, category_id: fora });
    await env.as(ana, (s) => s.rpc('pf_learn_words', { p_rules: [{ word: 'pizzaria', category_id: lazer }] }));
    expect((await rows<{ uses: number; category_id: number }>(ana, `select uses, category_id from public.pf_word_rules where word = 'pizzaria'`))[0]).toMatchObject({ uses: 1, category_id: lazer });
    // Categoria de outro espaço é ignorada; quem não está no espaço não lê as regras.
    await env.as(cris, (s) => s.rpc('pf_ensure_space', {}));
    const alheia = (await rows<{ id: number }>(cris, `select id from public.pf_categories limit 1`))[0]!.id;
    expect(await env.as(ana, (s) => s.rpc<number>('pf_learn_words', { p_rules: [{ word: 'teste', category_id: alheia }] }))).toBe(0);
    expect(await rows(cris, `select * from public.pf_word_rules`)).toEqual([]);
  });
});

describe('reset do sistema', () => {
  it('não apaga nada das finanças pessoais', async () => {
    await add(ana, { amount: 15, description: 'continua aqui' });
    await env.as(ana, (s) => s.rpc('reset_system', { p_confirm: 'APAGAR TUDO' }));
    expect((await rows<{ description: string }>(ana, `select description from public.pf_transactions`)).map((t) => t.description)).toEqual(['continua aqui']);
    expect((await rows(ana, `select 1 from public.pf_accounts`)).length).toBeGreaterThan(0);
  });
});
