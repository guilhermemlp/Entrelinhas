-- Etapa 1: integridade transacional, conclusão protegida e auditoria interna.
-- Aplicar no Supabase SQL Editor antes de publicar a versão da aplicação que usa save_entry_draft.

-- Auditoria: somente triggers internos podem inserir revisões.
drop policy if exists revision_insert on public.entry_revision;
revoke insert on public.entry_revision from authenticated;

create or replace function public.record_entry_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

create or replace function public.record_score_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st text;
begin
  if old.score is distinct from new.score then
    select status into st from public.daily_entry where id = old.entry_id;
    if st = 'complete' then
      insert into public.entry_revision (entry_id, payload)
      values (old.entry_id, jsonb_build_object(
        'indicator', old.indicator,
        'old_score', old.score,
        'new_score', new.score
      ));
    end if;
  end if;
  return new;
end;
$$;

-- Usuários não podem alterar status diretamente. Campos editáveis continuam permitidos.
revoke update on public.daily_entry from authenticated;
grant update (
  sleep_hours, sleep_notes, events_context, behavior_notes
) on public.daily_entry to authenticated;

-- Salva campos narrativos e os 45 indicadores em uma única transação.
-- Se qualquer validação/gravacão falhar, nada é persistido.
create or replace function public.save_entry_draft(
  p_entry_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_updated_at timestamptz;
  score_item record;
  expected_count integer;
  received_count integer;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload inválido';
  end if;

  if not (p_payload ? 'sleep_hours'
      and p_payload ? 'sleep_notes'
      and p_payload ? 'events_context'
      and p_payload ? 'behavior_notes'
      and p_payload ? 'scores') then
    raise exception 'Payload incompleto';
  end if;

  if jsonb_typeof(p_payload->'scores') <> 'object' then
    raise exception 'Indicadores inválidos';
  end if;

  select count(*) into expected_count from public.indicator_def;
  select count(*) into received_count from jsonb_object_keys(p_payload->'scores');
  if received_count <> expected_count then
    raise exception 'Quantidade de indicadores inválida';
  end if;

  for score_item in
    select key, value from jsonb_each(p_payload->'scores')
  loop
    if not exists (select 1 from public.indicator_def where key = score_item.key) then
      raise exception 'Indicador desconhecido: %', score_item.key;
    end if;
    if score_item.value <> 'null'::jsonb and
       (jsonb_typeof(score_item.value) <> 'number'
        or (score_item.value::text)::numeric < 0
        or (score_item.value::text)::numeric > 10
        or trunc((score_item.value::text)::numeric) <> (score_item.value::text)::numeric) then
      raise exception 'Pontuação inválida para %', score_item.key;
    end if;
  end loop;

  update public.daily_entry
     set sleep_hours = nullif(p_payload->>'sleep_hours', '')::numeric,
         sleep_notes = p_payload->>'sleep_notes',
         events_context = p_payload->>'events_context',
         behavior_notes = p_payload->>'behavior_notes'
   where id = p_entry_id
     and user_id = auth.uid()
     and updated_at = p_expected_updated_at
  returning updated_at into new_updated_at;

  if new_updated_at is null then
    raise exception 'Conflito: registro alterado em outra sessão ou não encontrado';
  end if;

  for score_item in
    select key, value from jsonb_each(p_payload->'scores')
  loop
    insert into public.indicator_score (entry_id, indicator, score)
    values (
      p_entry_id,
      score_item.key,
      case when score_item.value = 'null'::jsonb
        then null else (score_item.value::text)::smallint end
    )
    on conflict (entry_id, indicator)
    do update set score = excluded.score;
  end loop;

  return new_updated_at;
end;
$$;

revoke execute on function public.save_entry_draft(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.save_entry_draft(uuid, timestamptz, jsonb) to authenticated;

-- A conclusão é uma operação privilegiada e valida explicitamente a propriedade.
create or replace function public.complete_entry(p_entry_id uuid)
returns public.daily_entry
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.daily_entry;
  n_expected integer;
  n_filled integer;
begin
  select * into e
    from public.daily_entry
   where id = p_entry_id
     and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Registro não encontrado';
  end if;

  select count(*) into n_expected from public.indicator_def;
  select count(*) into n_filled
    from public.indicator_score
   where entry_id = p_entry_id and score is not null;

  if n_filled <> n_expected then
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

  update public.daily_entry
     set status = 'complete'
   where id = p_entry_id
  returning * into e;

  return e;
end;
$$;

revoke execute on function public.complete_entry(uuid) from public, anon;
grant execute on function public.complete_entry(uuid) to authenticated;
