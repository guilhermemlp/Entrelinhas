-- =============================================================
-- Diário de funcionamento psicológico — esquema inicial
-- Executar no SQL Editor do Supabase (ou via supabase db push).
-- =============================================================

-- Catálogo de indicadores: a lista de indicadores vive no banco,
-- com chave estrangeira, em vez de texto solto.
-- MANTER EM SINCRONIA com src/domain/indicators.ts (teste garante a contagem).
create table public.indicator_def (
  key        text primary key,
  dimension  text not null,
  label      text not null,
  position   smallint not null unique
);

insert into public.indicator_def (key, dimension, label, position) values
  -- 1. Humor
  ('tristeza','mood','Tristeza',1),
  ('alegria','mood','Alegria',2),
  ('euforia','mood','Euforia',3),
  ('apatia','mood','Apatia',4),
  ('irritabilidade','mood','Irritabilidade',5),
  ('estabilidade_emocional','mood','Estabilidade emocional',6),
  -- 2. Energia e ativação
  ('energia_fisica','energy','Energia física',7),
  ('energia_mental','energy','Energia mental',8),
  ('agitacao_interna','energy','Agitação interna',9),
  ('hiperatividade','energy','Hiperatividade',10),
  ('necessidade_movimento','energy','Necessidade de movimento',11),
  ('necessidade_estimulos','energy','Necessidade de estímulos',12),
  -- 3. Estado cognitivo
  ('velocidade_pensamentos','cognition','Velocidade dos pensamentos',13),
  ('concentracao','cognition','Concentração',14),
  ('clareza_mental','cognition','Clareza mental',15),
  ('ruminacao','cognition','Ruminação',16),
  ('pensamentos_acelerados','cognition','Pensamentos acelerados',17),
  ('capacidade_organizacao','cognition','Capacidade de organização',18),
  -- 4. Ansiedade e tensão
  ('preocupacao','anxiety','Preocupação',19),
  ('tensao_fisica','anxiety','Tensão física',20),
  ('inquietacao','anxiety','Inquietação',21),
  ('medo','anxiety','Medo',22),
  ('sensacao_urgencia','anxiety','Sensação de urgência',23),
  ('sintomas_fisicos','anxiety','Sintomas físicos',24),
  -- 5. Impulsividade e compulsividade
  ('busca_estimulos','impulsivity','Necessidade de buscar estímulos',25),
  ('dificuldade_interromper','impulsivity','Dificuldade de interromper comportamentos',26),
  ('busca_recompensas_imediatas','impulsivity','Busca por recompensas imediatas',27),
  ('comportamentos_repetitivos','impulsivity','Comportamentos repetitivos',28),
  ('controle_impulsos','impulsivity','Controle dos impulsos',29),
  -- 6. Sono e recuperação (horas dormidas ficam em daily_entry.sleep_hours)
  ('qualidade_sono','sleep','Qualidade do sono',30),
  ('facilidade_dormir','sleep','Facilidade para dormir',31),
  ('despertares_noturnos','sleep','Despertares noturnos',32),
  ('descanso_ao_acordar','sleep','Sensação de descanso ao acordar',33),
  -- 7. Comportamento e sociabilidade
  ('vontade_socializar','social','Vontade de socializar',34),
  ('isolamento','social','Isolamento',35),
  ('comunicacao','social','Comunicação',36),
  ('produtividade','social','Produtividade',37),
  ('motivacao','social','Motivação',38),
  ('necessidade_interacao','social','Necessidade de interação',39),
  -- 8. Contexto e acontecimentos (intensidade 0–10)
  ('situacoes_mudanca_emocional','context','Situações que provocaram mudanças emocionais',40),
  ('frustracoes','context','Frustrações',41),
  ('conflitos','context','Conflitos',42),
  ('atividades_prazerosas','context','Atividades prazerosas',43),
  ('exercicios_fisicos','context','Exercícios físicos',44),
  ('mudancas_rotina','context','Mudanças na rotina',45);

-- -------------------------------------------------------------
-- Registro diário: uma linha por usuário e data.
-- -------------------------------------------------------------
create table public.daily_entry (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date      date not null,
  sleep_hours     numeric(4,2) check (sleep_hours between 0 and 24),
  sleep_notes     text not null default '' check (length(sleep_notes) <= 2000),
  events_context  text not null default '' check (length(events_context) <= 5000),
  behavior_notes  text not null default '' check (length(behavior_notes) <= 5000),
  status          text not null default 'draft' check (status in ('draft','complete')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Regra "não sobrescrever outro dia": um registro por (usuário, data).
  unique (user_id, entry_date)
);

-- Notas de sono e contexto apenas dentro dos limites; campos narrativos
-- obrigatórios só são exigidos ao concluir (ver complete_entry).

create table public.indicator_score (
  entry_id   uuid not null references public.daily_entry(id) on delete cascade,
  indicator  text not null references public.indicator_def(key),
  score      smallint check (score between 0 and 10),   -- NULL = não preenchido
  primary key (entry_id, indicator)
);

-- Histórico de alterações de registros já concluídos (auditoria longitudinal).
create table public.entry_revision (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null references public.daily_entry(id) on delete cascade,
  payload     jsonb not null,
  changed_at  timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Triggers
-- -------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_entry_touch
  before update on public.daily_entry
  for each row execute function public.touch_updated_at();

-- Só registra revisão quando um campo editável de registro concluído muda.
create or replace function public.record_entry_revision() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.status = 'complete' and
     (old.sleep_hours, old.sleep_notes, old.events_context, old.behavior_notes)
     is distinct from
     (new.sleep_hours, new.sleep_notes, new.events_context, new.behavior_notes)
  then
    insert into public.entry_revision (entry_id, payload)
    values (old.id, to_jsonb(old));
  end if;
  return new;
end $$;

create trigger trg_entry_revision
  before update on public.daily_entry
  for each row execute function public.record_entry_revision();

-- Revisão quando a nota de um indicador muda em registro concluído.
create or replace function public.record_score_revision() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  st text;
begin
  if old.score is distinct from new.score then
    select status into st from public.daily_entry where id = old.entry_id;
    if st = 'complete' then
      insert into public.entry_revision (entry_id, payload)
      values (old.entry_id, jsonb_build_object(
        'indicator', old.indicator, 'old_score', old.score, 'new_score', new.score));
    end if;
  end if;
  return new;
end $$;

create trigger trg_score_revision
  before update on public.indicator_score
  for each row execute function public.record_score_revision();

-- -------------------------------------------------------------
-- Conclusão: a regra de completude é validada NO BANCO,
-- não só na interface.
-- -------------------------------------------------------------
create or replace function public.complete_entry(p_entry_id uuid)
returns public.daily_entry
language plpgsql security invoker set search_path = public as $$
declare
  e          public.daily_entry;
  n_expected int;
  n_filled   int;
begin
  select * into e from public.daily_entry where id = p_entry_id;  -- RLS aplica-se
  if not found then
    raise exception 'Registro não encontrado';
  end if;

  select count(*) into n_expected from public.indicator_def;
  select count(*) into n_filled
    from public.indicator_score
   where entry_id = p_entry_id and score is not null;

  if n_filled < n_expected then
    raise exception 'Preencha todos os indicadores (% de %)', n_filled, n_expected;
  end if;
  if e.sleep_hours is null then
    raise exception 'Informe as horas de sono';
  end if;
  if btrim(e.events_context) = '' then
    raise exception 'O campo "Acontecimentos e contexto" é obrigatório';
  end if;
  if btrim(e.behavior_notes) = '' then
    raise exception 'O campo "Observações sobre seu comportamento" é obrigatório';
  end if;

  update public.daily_entry set status = 'complete'
   where id = p_entry_id
  returning * into e;
  return e;
end $$;

-- -------------------------------------------------------------
-- Row Level Security
-- Usuário só vê e altera os próprios dados. NÃO há política de DELETE:
-- registros não podem ser apagados pela API comum (integridade).
-- Apagamento para fins de LGPD passa pela função erase_my_data().
-- -------------------------------------------------------------
alter table public.indicator_def enable row level security;
create policy indicator_def_read on public.indicator_def
  for select to authenticated using (true);

alter table public.daily_entry enable row level security;
create policy entry_select on public.daily_entry
  for select to authenticated using (user_id = auth.uid());
create policy entry_insert on public.daily_entry
  for insert to authenticated with check (user_id = auth.uid());
create policy entry_update on public.daily_entry
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.indicator_score enable row level security;
create policy score_select on public.indicator_score
  for select to authenticated using (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()));
create policy score_insert on public.indicator_score
  for insert to authenticated with check (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()));
create policy score_update on public.indicator_score
  for update to authenticated using (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()))
  with check (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()));

alter table public.entry_revision enable row level security;
create policy revision_select on public.entry_revision
  for select to authenticated using (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()));
create policy revision_insert on public.entry_revision
  for insert to authenticated with check (
    exists (select 1 from public.daily_entry e
            where e.id = entry_id and e.user_id = auth.uid()));
-- Sem políticas de update/delete em entry_revision: a auditoria é append-only.

-- -------------------------------------------------------------
-- Apagamento total dos dados do próprio usuário (direito de eliminação, LGPD).
-- Ação explícita, separada da API comum.
-- -------------------------------------------------------------
create or replace function public.erase_my_data() returns void
language sql security definer set search_path = public as $$
  delete from public.daily_entry where user_id = auth.uid();
$$;

revoke execute on function public.erase_my_data() from anon;
grant execute on function public.erase_my_data() to authenticated;
grant execute on function public.complete_entry(uuid) to authenticated;

-- -------------------------------------------------------------
-- Grants: o Supabase não concede privilégios automaticamente para
-- tabelas criadas via SQL Editor. Sem isso, mesmo usuários autenticados
-- recebem "permission denied for table ..." (42501).
-- -------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.daily_entry to authenticated;
grant select, insert, update on public.indicator_score to authenticated;
grant select on public.indicator_def to anon, authenticated;
grant select, insert on public.entry_revision to authenticated;
