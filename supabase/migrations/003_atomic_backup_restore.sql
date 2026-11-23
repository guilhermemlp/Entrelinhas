-- Etapa 2: restauração de backup atômica e isolada por usuário.
-- A função valida todo o lote e executa a importação em uma única transação.
-- Em qualquer erro, o PostgreSQL desfaz a operação inteira.

create or replace function public.restore_entries(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_entry_id uuid;
  v_date date;
  v_status text;
  v_score record;
  v_expected_count integer;
  v_received_count integer;
  v_imported integer := 0;
  v_skipped date[] := array[]::date[];
  v_seen_dates date[] := array[]::date[];
begin
  if v_user_id is null then
    raise exception 'Sessão inválida';
  end if;

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'O backup deve conter uma lista de registros';
  end if;

  if jsonb_array_length(p_entries) > 5000 then
    raise exception 'O backup excede o limite de 5.000 registros por importação';
  end if;

  select count(*) into v_expected_count from public.indicator_def;

  for v_item in select value from jsonb_array_elements(p_entries)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'entry_date' and v_item ? 'status'
       and v_item ? 'sleep_hours' and v_item ? 'sleep_notes'
       and v_item ? 'events_context' and v_item ? 'behavior_notes'
       and v_item ? 'scores') then
      raise exception 'Registro de backup com estrutura inválida';
    end if;

    begin
      v_date := (v_item->>'entry_date')::date;
    exception when others then
      raise exception 'Data inválida no backup: %', v_item->>'entry_date';
    end;

    if v_date = any(v_seen_dates) then
      raise exception 'O backup contém a data duplicada: %', v_date;
    end if;
    v_seen_dates := array_append(v_seen_dates, v_date);

    v_status := v_item->>'status';
    if v_status is null or v_status not in ('draft', 'complete') then
      raise exception 'Status inválido no backup para %', v_date;
    end if;

    if jsonb_typeof(v_item->'scores') <> 'object' then
      raise exception 'Indicadores inválidos no registro %', v_date;
    end if;

    select count(*) into v_received_count
      from jsonb_object_keys(v_item->'scores');
    if v_received_count <> v_expected_count then
      raise exception 'Quantidade de indicadores inválida no registro %', v_date;
    end if;

    for v_score in
      select key, value from jsonb_each(v_item->'scores')
    loop
      if not exists (select 1 from public.indicator_def where key = v_score.key) then
        raise exception 'Indicador desconhecido no registro %: %', v_date, v_score.key;
      end if;
      if v_score.value <> 'null'::jsonb and
         (jsonb_typeof(v_score.value) <> 'number'
          or (v_score.value::text)::numeric < 0
          or (v_score.value::text)::numeric > 10
          or trunc((v_score.value::text)::numeric) <> (v_score.value::text)::numeric) then
        raise exception 'Pontuação inválida no registro %: %', v_date, v_score.key;
      end if;
    end loop;

    if v_item->'sleep_hours' <> 'null'::jsonb then
      if jsonb_typeof(v_item->'sleep_hours') <> 'number'
         or (v_item->>'sleep_hours')::numeric < 0
         or (v_item->>'sleep_hours')::numeric > 24 then
        raise exception 'Horas de sono inválidas no registro %', v_date;
      end if;
    end if;

    if length(v_item->>'sleep_notes') > 2000
       or length(v_item->>'events_context') > 5000
       or length(v_item->>'behavior_notes') > 5000 then
      raise exception 'Texto excede o limite permitido no registro %', v_date;
    end if;

    insert into public.daily_entry (
      user_id, entry_date, sleep_hours, sleep_notes,
      events_context, behavior_notes, status
    ) values (
      v_user_id,
      v_date,
      nullif(v_item->>'sleep_hours', '')::numeric,
      v_item->>'sleep_notes',
      v_item->>'events_context',
      v_item->>'behavior_notes',
      'draft'
    )
    on conflict (user_id, entry_date) do nothing
    returning id into v_entry_id;

    if v_entry_id is null then
      v_skipped := array_append(v_skipped, v_date);
      continue;
    end if;

    for v_score in
      select key, value from jsonb_each(v_item->'scores')
    loop
      insert into public.indicator_score (entry_id, indicator, score)
      values (
        v_entry_id,
        v_score.key,
        case when v_score.value = 'null'::jsonb
          then null else (v_score.value::text)::smallint end
      );
    end loop;

    if v_status = 'complete' then
      perform public.complete_entry(v_entry_id);
    end if;

    v_imported := v_imported + 1;
    v_entry_id := null;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'skipped', to_jsonb(v_skipped)
  );
end;
$$;

revoke execute on function public.restore_entries(jsonb) from public, anon;
grant execute on function public.restore_entries(jsonb) to authenticated;
