# Backup e restauração

A estrutura do banco está nas migrations (versionadas no GitHub). O backup guarda **os dados**.

## Backup

Requisito: `pg_dump` (no macOS: `brew install libpq && brew link --force libpq`).

```bash
npm run backup:db
```

O script lê `SUPABASE_DB_URL` do ambiente (exporte antes, ou rode com `SUPABASE_DB_URL='...' npm run backup:db`) e grava `backups/wabee-AAAA-MM-DD_HHMM.sql.gz`, com permissão só para você.

- A pasta `backups/` está no `.gitignore`: **nunca** envie backups ao GitHub. Eles têm dados de clientes e valores.
- Guarde uma cópia fora do computador, num local criptografado.
- Frequência sugerida: semanal e antes de qualquer mudança grande (migration nova com alteração de dados, troca de região).

Confira também em **Supabase → Database → Backups** o que o seu plano oferece; os backups automáticos do plano não substituem uma cópia sob seu controle.

O backup **não** inclui as contas de login (Supabase Auth) nem `app_members`/`profiles`, que dependem delas.

## Restaurar

Num projeto Supabase novo (ou num banco de teste):

1. Aplique a estrutura: `SUPABASE_DB_URL='<banco novo>' npm run db:migrate`.
2. Apague os dados de exemplo que as migrations criam (categorias, canais e configurações vêm de novo no backup):
   ```sql
   truncate public.financial_categories, public.sales_channels, public.sales_channel_fees, public.settings restart identity cascade;
   ```
3. Restaure os dados:
   ```bash
   gunzip -c backups/wabee-AAAA-MM-DD_HHMM.sql.gz | psql "$TARGET_DB_URL" --single-transaction -v ON_ERROR_STOP=1
   ```
4. Ajuste as sequências, para os próximos registros continuarem a numeração:
   ```sql
   do $$
   declare r record;
   begin
     for r in select format('%I.%I', table_schema, table_name) as t from information_schema.columns
              where table_schema = 'public' and column_name = 'id' and is_identity = 'YES' loop
       execute format('select setval(pg_get_serial_sequence(%L, ''id''), coalesce((select max(id) from %s), 0) + 1, false)', r.t, r.t);
     end loop;
   end $$;
   ```
5. Recrie as contas (convite no Auth) e os perfis com `npm run member:add`.
6. Entre no app como dono e abra **Financeiro → Fechamento**: o item "Estoque conferido" deve estar ok.

O arquivo começa com `SET session_replication_role = replica` para não disparar as travas e a auditoria durante a carga. Se o banco recusar esse comando, restaure como o usuário `postgres` pela connection string do painel.

Teste a restauração num projeto separado de vez em quando: um backup que nunca foi restaurado não é garantia.
