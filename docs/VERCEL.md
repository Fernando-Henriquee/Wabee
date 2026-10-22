# Vercel

O repositório está ligado à Vercel: cada push na `main` gera um deploy de produção; branches e pull requests geram deploys de prévia.

## Variáveis de ambiente

Em **Project → Settings → Environment Variables**:

| Nome | Valor | Ambientes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Project URL do Supabase | Production, Preview |
| `VITE_SUPABASE_ANON_KEY` | chave `anon` / publishable | Production, Preview |
| `VITE_APP_ENV` | `production` (em Preview, `preview`) | Production, Preview |

Só variáveis com prefixo `VITE_` chegam ao app, e elas ficam visíveis no navegador. Nunca cadastre aqui a connection string do banco nem a chave `service_role`.

Depois de mudar uma variável, faça um **Redeploy**: o Vite grava os valores no build.

## Build

- Comando: `npm run build` (checa os tipos e gera `dist/`).
- `vercel.json` define as rotas da SPA, os cabeçalhos de segurança (CSP liberando só o próprio site e `*.supabase.co`) e o cache: arquivos com hash ficam em cache longo e `index.html`/`sw.js` nunca.

Antes de cada push, rode `npm run check`: um build quebrado na `main` vira um deploy com falha.

## Domínio próprio

1. **Settings → Domains → Add** e siga as instruções de DNS.
2. No Supabase, atualize **Site URL** e **Redirect URLs** com o novo domínio (veja `docs/SUPABASE.md`), senão os links de redefinição de senha apontam para o endereço antigo.

## Atualização do app instalado (PWA)

O app instalado no celular guarda os arquivos para abrir rápido e funcionar com conexão ruim. Quando sai uma versão nova, aparece o aviso **"Nova versão disponível"**; ao tocar em atualizar, o app recarrega com a versão nova. Ninguém fica preso numa versão antiga sem saber.

Escritas nunca ficam guardadas para depois: sem conexão, o app avisa e não grava.
