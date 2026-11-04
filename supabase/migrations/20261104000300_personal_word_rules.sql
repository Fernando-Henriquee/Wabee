-- =============================================================================
-- Finanças pessoais: palavras aprendidas pela voz. Quando o dono corrige a categoria de um
-- gasto falado ("pizzaria" → Alimentação fora), a palavra fica guardada e da próxima vez o
-- interpretador já acerta.
-- =============================================================================

create table public.pf_word_rules (
  space_id bigint not null references public.pf_spaces (id) on delete cascade,
  word text not null check (char_length(word) between 2 and 40),
  category_id bigint not null references public.pf_categories (id) on delete cascade,
  uses integer not null default 1 check (uses >= 1),
  updated_at timestamptz not null default now(),
  primary key (space_id, word)
);

alter table public.pf_word_rules enable row level security;
create policy pf_word_rules_select on public.pf_word_rules for select to authenticated
  using (private.has_role(array['dono']) and space_id in (select m.space_id from public.pf_space_members m where m.user_id = (select auth.uid())));

-- p_rules: [{word, category_id}]. A palavra é guardada sem acento e em minúsculas.
create function public.pf_learn_words(p_rules jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space bigint := private.pf_space();
  v_rule jsonb;
  v_word text;
  v_category bigint;
  v_count integer := 0;
begin
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'Formato inválido.' using errcode = '22023';
  end if;
  for v_rule in select * from jsonb_array_elements(p_rules) loop
    v_word := lower(btrim(coalesce(v_rule ->> 'word', '')));
    v_category := nullif(v_rule ->> 'category_id', '')::bigint;
    continue when char_length(v_word) < 2 or char_length(v_word) > 40 or v_category is null;
    continue when not exists (select 1 from public.pf_categories c where c.id = v_category and c.space_id = v_space);
    insert into public.pf_word_rules (space_id, word, category_id) values (v_space, v_word, v_category)
    on conflict (space_id, word) do update
      set uses = case when public.pf_word_rules.category_id = excluded.category_id then public.pf_word_rules.uses + 1 else 1 end,
          category_id = excluded.category_id, updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

select private.apply_grants();
