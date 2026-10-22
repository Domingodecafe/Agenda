-- Ana / Agenda: banco dedicado. Execute somente em um projeto Supabase da agenda.
-- Não executar no projeto "base LADO A".
-- RLS isola os registros por usuário autenticado.
create table if not exists public.agenda_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint agenda_payload_valid check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'clients') = 'array'
    and jsonb_typeof(payload->'appointments') = 'array'
    and jsonb_typeof(payload->'settings') = 'object'
  )
);
alter table public.agenda_snapshots enable row level security;
revoke all on public.agenda_snapshots from public, anon;
grant select, insert, update on public.agenda_snapshots to authenticated;

create policy "agenda_select_own" on public.agenda_snapshots
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "agenda_insert_own" on public.agenda_snapshots
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "agenda_update_own" on public.agenda_snapshots
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- A gravação compara a revisão no servidor, evitando sobrescrever dados
-- modificados em outro dispositivo ou por uma futura integração da Ana.
create or replace function public.write_agenda_snapshot(
  p_expected_revision bigint, p_payload jsonb
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_new_revision bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTENTICACAO_NECESSARIA';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload->'clients') <> 'array'
    or jsonb_typeof(p_payload->'appointments') <> 'array'
    or jsonb_typeof(p_payload->'settings') <> 'object' then
    raise exception 'DADOS_INVALIDOS';
  end if;
  if p_expected_revision = 0 then
    insert into public.agenda_snapshots(owner_id, revision, payload)
    values ((select auth.uid()), 1, p_payload)
    on conflict (owner_id) do nothing
    returning revision into v_new_revision;
  else
    update public.agenda_snapshots
      set payload = p_payload, revision = revision + 1, updated_at = now()
    where owner_id = (select auth.uid())
      and revision = p_expected_revision
    returning revision into v_new_revision;
  end if;
  if v_new_revision is null then
    raise exception 'CONFLITO_REVISAO: recarregue e revise as alterações';
  end if;
  return v_new_revision;
end;
$$;
revoke all on function public.write_agenda_snapshot(bigint,jsonb) from public, anon;
grant execute on function public.write_agenda_snapshot(bigint,jsonb) to authenticated;
