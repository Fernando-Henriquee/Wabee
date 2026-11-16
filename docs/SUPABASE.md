# Supabase

O Supabase guarda os dados, faz o login e executa todas as regras de negócio (funções PL/pgSQL nas migrations).

## Chaves e onde cada uma fica

| Valor | Onde | Pode ir para o navegador? |
| --- | --- | --- |
| Project URL | `.env.local` e Vercel (`VITE_SUPABASE_URL`) | Sim |
| Chave `anon` / publishable | `.env.local` e Vercel (`VITE_SUPABASE_ANON_KEY`) | Sim: todas as tabelas têm RLS e o perfil anônimo não tem permissão nenhuma |
| Connection string do banco (com senha) | Só `.env.local` (`SUPABASE_DB_URL`) | **Não**. Nunca com prefixo `VITE_`, nunca na Vercel |
| Chave `service_role` / secret | Não é usada pelo app | **Não**. Não coloque em arquivo nenhum do projeto |

Para `SUPABASE_DB_URL`, use **Connect → Session pooler → URI** (a conexão direta é só IPv6 e costuma falhar em redes domésticas).

## Migrations

As migrations em `supabase/migrations/` são a fonte da verdade do banco. Nunca altere o banco pelo painel (Table Editor). Para mudar algo, crie uma migration nova; as antigas já aplicadas não são editadas.

```bash
npm run test:db                    # roda as regras contra um PostgreSQL local com todas as migrations
npm run db:migrate -- --status     # aplicadas e pendentes no Supabase
npm run db:migrate -- --dry-run    # o que seria aplicado
npm run db:migrate                 # aplica as pendentes, cada uma numa transação
```

O script registra o que aplicou em `supabase_migrations.schema_migrations`, a mesma tabela da Supabase CLI.

**Projeto novo do zero:** `npm run sql:bundle` gera `supabase/.bundle/instalacao-completa.sql`. Cole tudo no SQL Editor de um projeto vazio e execute.

## Autenticação

Em **Authentication → Sign In / Providers**:
- desative **Allow new users to sign up** (ninguém cria conta sozinho);
- mantenha **Email** habilitado.

Em **Authentication → URL Configuration**:
- **Site URL**: o endereço do app na Vercel (ex.: `https://wabee.vercel.app`);
- **Redirect URLs**: `https://<seu-dominio>/redefinir-senha` (e o domínio próprio, se houver).

## Empresas, pessoas e convites

O Wabee é multi-empresa: cada **empresa** é um espaço isolado, e quem não é membro dela não vê nada. Uma conta pode ter a sua empresa e ser convidada para outras (seletor no menu da conta).

- **Perfis**: `dono` (acesso a tudo e gerencia pessoas: convida, remove, muda o perfil) e `membro` (acesso a tudo da empresa, sem gerir pessoas).
- **Convite pelo app**: o dono abre **Configurações → Pessoas da empresa**, digita o e-mail e envia. Quem já tem conta vê o convite ao entrar (menu da conta → "Convites"); quem não tem recebe o e-mail do Supabase, cria a senha e aceita o convite. O cadastro público continua desligado (`enable_signup = false`).
- **Criar empresa**: qualquer conta logada cria a própria (menu da conta → "Nova empresa") e vira dona dela.

### Função de convite (uma vez por projeto)

O envio do e-mail usa a função de borda `invite-member` (`supabase/functions/invite-member/`). Ela é a única que usa a chave administrativa (`service_role`), que existe só no ambiente da função, nunca no navegador.

```bash
supabase functions deploy invite-member
supabase secrets set SITE_URL=https://<seu-dominio>
```

`SITE_URL` é o endereço do app (o link do e-mail leva para `/redefinir-senha`). Sem a função publicada, o botão de convite mostra erro.

### Caminho administrativo (sem o app)

Para liberar uma conta já criada em **Authentication → Users** numa empresa:

```bash
npm run member:add -- pessoa@exemplo.com membro "Nome da pessoa" "Nome da empresa"
```

O último argumento (id ou nome da empresa) pode ser omitido se só existir uma. Para criar a conta do dono direto pelo SQL Editor, use `supabase/diagnostico/criar-usuario-dono.sql`: troque e-mail, senha e nome no topo e execute. Se não existir empresa, ele cria a "Wabee".

### Como o isolamento funciona

- Toda tabela de negócio tem `company_id`; a RLS só deixa passar linhas da **empresa ativa** da pessoa. O app envia a empresa escolhida no cabeçalho `x-company-id`; o banco confere o vínculo (`private.company_id()`), e sem vínculo nenhuma linha volta.
- Tabelas e funções pertencem ao papel `wabee_owner`, sem `BYPASSRLS`, e as tabelas têm `FORCE ROW LEVEL SECURITY`. Por isso as RPCs `security definer` também só enxergam a empresa ativa: um id de outra empresa devolve "não encontrado".
- As chaves estrangeiras entre tabelas de negócio são compostas `(company_id, id)`: nada aponta para dado de outra empresa.
- Fotos ficam em `{id-da-empresa}/{pasta}/{arquivo}` no bucket; só quem é da empresa envia ou apaga. O bucket continua público: quem tiver o link de uma foto a vê.
- **Tabela nova**: crie com `company_id uuid not null default private.company_id()` (FK para `companies`) e termine a migration com `select private.apply_grants();` (ele liga RLS forçada, políticas e dono). O teste `tests/db/tenancy.test.ts` falha se uma tabela ficar sem essa proteção.
- **Finanças pessoais** (`pf_*`) são da conta, fora de qualquer empresa.

## Modelo de segurança

- **RLS em todas as tabelas.** Quem não é membro ativo da empresa não lê nada dela.
- **Escrita só por RPC.** O perfil `authenticated` só tem `SELECT`. Cada função confere o acesso à empresa (`private.assert_role`) e, nas ações de gestão, o perfil dono, valida os dados e registra na auditoria.
- **Funções internas** ficam no schema `private`, sem acesso pela API. Só as poucas usadas por políticas e views têm `EXECUTE` (lista em `private.apply_grants()`, chamada no fim de cada migration).
- **Mês fechado** bloqueia lançamentos e estornos com data nele (`private.assert_open_period`).

Conferências que valem rodar no SQL Editor depois de mudanças grandes:

```sql
-- tabelas sem RLS (deve voltar vazio)
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- privilégios de escrita para authenticated (deve voltar vazio)
select table_name, privilege_type from information_schema.role_table_grants
where grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
```

## Região

O projeto atual está em `us-east-1`. Funciona bem; cada operação fica ~120 ms mais lenta do que estaria em São Paulo. Para mudar de região é preciso criar outro projeto, aplicar as migrations e restaurar um backup (veja `docs/BACKUP.md`).
