#!/usr/bin/env bash
# Backup dos dados do Magi Doces (veja docs/BACKUP.md).
# Uso: SUPABASE_DB_URL='postgresql://...' npm run backup:db
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Defina SUPABASE_DB_URL (Supabase → Project Settings → Database → Connection string)." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump não encontrado. No macOS: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

mkdir -p backups
chmod 700 backups
file="backups/magi-doces-$(date +%Y-%m-%d_%H%M).sql.gz"

# Somente dados do schema public: a estrutura vem das migrations versionadas.
# Não usar --table junto com --schema: o pg_dump exportaria só a tabela indicada.
# Membros e perfis dependem das contas do Auth (fora do dump) e são recriados no provisionamento.
# Mesmos parâmetros validados em tests/db/backup.test.ts.
{
  echo "-- Restaure com: gunzip -c ARQUIVO | psql \"\$TARGET_DB_URL\" --single-transaction -v ON_ERROR_STOP=1"
  echo "SET session_replication_role = replica;"
  pg_dump "$SUPABASE_DB_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --schema=public \
    --exclude-table-data=public.business_members \
    --exclude-table-data=public.profiles
} | gzip -9 > "$file"

chmod 600 "$file"
echo "Backup gravado em $file ($(du -h "$file" | cut -f1))."
echo "Guarde-o em local seguro e criptografado. Não envie ao GitHub."
