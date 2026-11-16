# Wabee — Gestão

Sistema de gestão da Wabee (impressão 3D): estoque de filamentos e componentes, produtos com ficha técnica, produção, compras, vendas e financeiro, com custo por camada (material, energia, depreciação, operacional e trabalho) e o investimento do dono separado do caixa da empresa.

App web instalável (PWA) em React + Vite, hospedado na Vercel, com banco, login e regras de negócio no Supabase.

## Módulos

| Módulo | Rotas | O que faz |
| --- | --- | --- |
| Visão geral | `/` | Indicadores do período, caminho do valor, alertas, impressora agora |
| Estoque | `/estoque` | Itens, carretéis, saldo inicial, saídas, ajustes e extrato |
| Produtos | `/produtos` | Variações, ficha técnica versionada com custo ao vivo, preços por canal |
| Produção | `/producao` | Quadro, planejar/iniciar/finalizar impressões, falhas, acabamento, equipamentos e taxas |
| Compras | `/compras`, `/fornecedores` | Compra com rateio de frete, parcelas, quem pagou (empresa/dono), recebimento |
| Vendas | `/vendas`, `/clientes` | Venda rápida (modo feira), encomendas com sinal, reservas, entrega, recebimento |
| Financeiro | `/financeiro` | A pagar/receber, despesas, contas, caixa, DRE, dono e fechamento do mês |
| Configurações | `/configuracoes`, `/auditoria` | Empresa e regras, canais e taxas, pessoas, aplicativo, auditoria |

Multi-empresa: qualquer pessoa cria a própria conta e empresa (tela **Criar conta**); cada empresa é um espaço isolado e só entra em outra quem for convidado por alguém dela. Perfis: **dono** (tudo, e gerencia as pessoas) e **membro** (acesso a tudo da empresa).

## Como funciona por dentro

- **Toda escrita passa por funções do banco** (`rpc(...)`, PL/pgSQL `security definer`). O navegador só lê; as tabelas têm RLS e o perfil `authenticated` não tem permissão de inserir, alterar ou apagar.
- **Estoque é um razão imutável** (`stock_movements`): saldo e custo médio por camada saem das movimentações. Nada é apagado; correções são estornos.
- **Resultado (DRE) e caixa são separados**: `result_entries` por competência, `cash_transactions` só nas contas da empresa e `owner_movements` para o que o dono paga ou retira.
- **Idempotência**: operações recebem um `p_request_id`, então um clique duplo ou uma reconexão não grava duas vezes.
- **Isolamento por empresa**: toda tabela de negócio tem `company_id` e RLS forçada; uma conta só enxerga as empresas de que faz parte (detalhes em `docs/SUPABASE.md`).

## Rodar na sua máquina

Requisitos: Node 20+.

```bash
npm install
npm run dev:local -- --demo   # emulador do Supabase (PGlite) + Vite, com dados de demonstração
```

Abra http://localhost:5173 e entre com `dono@local.test` / `senha-local-123` (também há `membro@local.test`, da mesma empresa, e `outra@local.test`, dona de outra empresa que não vê nada da primeira). Os dados locais ficam em `.local-backend/` e não têm relação com os dados reais.

Para usar o Supabase real em desenvolvimento, copie `.env.example` para `.env.local`, preencha e rode `npm run dev`.

## Scripts

| Comando | Para quê |
| --- | --- |
| `npm run dev:local -- --demo` | Ambiente local completo |
| `npm run check` | Tipos, lint, testes e build (rode antes de cada push) |
| `npm run test:unit` / `npm run test:db` | Testes da interface / do banco (PGlite com as migrations reais) |
| `npm run db:migrate` | Aplica no Supabase as migrations pendentes (`-- --status`, `-- --dry-run`) |
| `npm run member:add -- email dono "Nome" [empresa]` | Dá acesso a uma empresa para uma conta já criada no Supabase Auth |
| `npm run backup:db` | Backup dos dados (veja `docs/BACKUP.md`) |
| `npm run sql:bundle` | Junta todas as migrations num arquivo para um projeto novo |
| `npm run icons` | Gera os ícones do PWA a partir de `public/icon.svg` |

## Estrutura

```
src/
  app/            rotas, guarda de acesso
  components/     ui (botões, campos, diálogos), shared (tabela, filtros), layout, charts
  data/           tipos, consultas e escritas por módulo (uma função por RPC)
  features/       telas por módulo
  lib/            dinheiro (pt-BR), datas, cálculos, exportação, PWA
supabase/
  migrations/     esquema, regras e RPCs (fonte da verdade)
  diagnostico/    SQL de apoio para colar no SQL Editor
tests/db/         testes de regra de negócio no banco
tools/local-backend/  emulador local do Supabase
```

## Publicar

Cada push na `main` gera um deploy na Vercel. Fluxo usado no projeto: testar → aplicar migrations no Supabase (`npm run db:migrate`) → `npm run check` → commit → push.

- `docs/SUPABASE.md`: banco, autenticação, contas e segurança
- `docs/VERCEL.md`: variáveis de ambiente, domínio e atualização do app
- `docs/BACKUP.md`: backup e restauração
