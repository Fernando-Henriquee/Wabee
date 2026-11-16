-- =============================================================================
-- Wabee — Compatibilidade com a versão antiga do app (app_members)
--
-- O app é um PWA: cada aparelho guarda a versão que baixou e só troca quando a pessoa aceita o aviso
-- "Nova versão disponível". A versão antiga lê a tabela app_members, que a migration de multi-empresa
-- removeu; quem ainda estava nela via "Could not find the table 'public.app_members'" e ficava preso
-- numa tela de erro (o aviso de atualização só aparece dentro do app).
--
-- Esta view devolve, só para a própria pessoa, o vínculo dela no formato antigo, para a versão antiga
-- continuar abrindo até o aparelho atualizar (dono continua dono; membro entra como "leitura" no app
-- antigo). A versão nova não usa esta view. Pode ser removida quando ninguém mais usar a versão antiga.
-- =============================================================================

create view public.app_members as
select m.user_id,
       case when m.role = 'dono' then 'dono' else 'leitura' end::text as role,
       m.active,
       m.created_at,
       m.updated_at
from public.company_members m
where m.user_id = (select auth.uid()) and m.active;

comment on view public.app_members is 'Compatibilidade com a versão antiga do app. Não usar em código novo: use company_members.';

select private.apply_grants();
