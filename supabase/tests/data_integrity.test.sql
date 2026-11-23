-- Testes de integração do banco: executar com `supabase test db`.
-- Requer as três migrações aplicadas no banco local.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Usuários de teste isolados; não usar dados reais.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '10000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'entrelinhas-a@example.test', '',
   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '20000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'entrelinhas-b@example.test', '',
   now(), now(), now())
on conflict (id) do nothing;

insert into public.daily_entry (id, user_id, entry_date)
values
  ('30000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001', date '2026-01-10'),
  ('40000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000002', date '2026-01-10');

-- Simula uma sessão autenticada do primeiro usuário.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.daily_entry),
  1,
  'RLS: usuário enxerga somente o próprio registro'
);

select is(
  (select count(*)::integer from public.daily_entry
    where id = '40000000-0000-0000-0000-000000000004'),
  0,
  'RLS: registro de outro usuário fica invisível'
);

select lives_ok(
  $$
    select public.save_entry_draft(
      '30000000-0000-0000-0000-000000000003',
      (select updated_at from public.daily_entry
        where id = '30000000-0000-0000-0000-000000000003'),
      jsonb_build_object(
        'sleep_hours', 7.5,
        'sleep_notes', 'teste',
        'events_context', 'contexto de teste',
        'behavior_notes', 'observação de teste',
        'scores', (select jsonb_object_agg(key, 1)
                     from public.indicator_def)
      )
    )
  $$,
  'salvamento transacional aceita payload completo e válido'
);

select lives_ok(
  $$ select public.complete_entry(
       '30000000-0000-0000-0000-000000000003'
     ) $$,
  'conclusão ocorre pela função protegida do banco'
);

select throws_ok(
  $$ update public.daily_entry
        set status = 'draft'
      where id = '30000000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'usuário não pode alterar status diretamente'
);

select lives_ok(
  $$ update public.daily_entry
        set behavior_notes = 'observação revisada'
      where id = '30000000-0000-0000-0000-000000000003' $$,
  'edição de campo permitido em registro concluído é aceita'
);

select is(
  (select count(*)::integer from public.entry_revision
    where entry_id = '30000000-0000-0000-0000-000000000003'),
  1,
  'trigger grava revisão sem conceder INSERT direto ao usuário'
);

select throws_ok(
  $$ insert into public.entry_revision (entry_id, payload)
       values (
         '30000000-0000-0000-0000-000000000003',
         '{"forged":true}'::jsonb
       ) $$,
  '42501',
  null,
  'usuário não pode forjar eventos de auditoria'
);

select throws_ok(
  $$ select public.complete_entry(
       '40000000-0000-0000-0000-000000000004'
     ) $$,
  'P0001',
  'Registro não encontrado',
  'usuário não consegue concluir registro pertencente a outra conta'
);

select lives_ok(
  $$
    select public.restore_entries(
      jsonb_build_array(
        jsonb_build_object(
          'entry_date', '2026-01-11',
          'status', 'complete',
          'sleep_hours', 8,
          'sleep_notes', '',
          'events_context', 'restauração de teste',
          'behavior_notes', 'registro restaurado',
          'scores', (select jsonb_object_agg(key, 2)
                       from public.indicator_def)
        )
      )
    )
  $$,
  'restauração importa registro completo usando validação do banco'
);

select throws_ok(
  $$
    select public.restore_entries(
      jsonb_build_array(
        jsonb_build_object(
          'entry_date', '2026-01-12',
          'status', 'draft',
          'sleep_hours', 7,
          'sleep_notes', '',
          'events_context', '',
          'behavior_notes', '',
          'scores', (select jsonb_object_agg(key, 3)
                       from public.indicator_def)
        ),
        jsonb_build_object(
          'entry_date', '2026-01-13',
          'status', 'draft',
          'sleep_hours', 7,
          'sleep_notes', '',
          'events_context', '',
          'behavior_notes', '',
          'scores', '{"indicador_inexistente":4}'::jsonb
        )
      )
    )
  $$,
  'P0001',
  'Quantidade de indicadores inválida no registro 2026-01-12',
  'restauração rejeita lote que contém registro inválido'
);

select is(
  (select count(*)::integer from public.daily_entry
    where user_id = '10000000-0000-0000-0000-000000000001'
      and entry_date = date '2026-01-12'),
  0,
  'falha em um item desfaz também os itens válidos anteriores do lote'
);

select * from finish();
rollback;
