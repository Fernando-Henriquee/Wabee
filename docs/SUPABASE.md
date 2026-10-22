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

## Dar acesso a uma pessoa

1. **Authentication → Users → Invite user** com o e-mail da pessoa. Ela recebe o convite e define a senha.
2. Dê o perfil:
   ```bash
   npm run member:add -- pessoa@exemplo.com producao "Nome da pessoa"
   ```
   Perfis: `dono`, `producao`, `leitura`. Depois disso o dono pode trocar o perfil ou desativar o acesso em **Configurações → Pessoas com acesso**.

Sem a linha em `app_members` a pessoa entra mas vê "sem acesso".

Para criar a conta do dono direto pelo SQL Editor (sem convite por e-mail), use `supabase/diagnostico/criar-usuario-dono.sql`: troque e-mail, senha e nome no topo e execute. Se a conta já existir, o script só redefine a senha e garante o perfil de dono.

## Modelo de segurança

- **RLS em todas as tabelas.** Quem não é membro ativo não lê nada. A produção não lê tabelas financeiras e vê os custos como vazios nas views `v_*`.
- **Escrita só por RPC.** O perfil `authenticated` só tem `SELECT`. Cada função confere o perfil (`private.assert_role`), valida os dados e registra na auditoria.
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
