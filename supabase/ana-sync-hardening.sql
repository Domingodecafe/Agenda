-- Somente Secretaria Ana DEV (dpdxzbbzymkygutwefww). Não executa migração de dados.
begin;
alter table public.agenda_snapshots drop constraint if exists agenda_payload_valid;
alter table public.agenda_snapshots add constraint agenda_payload_valid check (
  jsonb_typeof(payload) is not distinct from 'object'
  and jsonb_typeof(payload->'clients') is not distinct from 'array'
  and jsonb_typeof(payload->'appointments') is not distinct from 'array'
  and jsonb_typeof(payload->'settings') is not distinct from 'object'
);

-- Também impede PATCH direto sem avanço da revisão. A função RPC mantém o CAS.
create or replace function public.guard_agenda_snapshot_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.revision is distinct from 1 then raise exception 'CONFLITO_REVISAO: revisão inicial deve ser 1'; end if;
  else
    if new.owner_id is distinct from old.owner_id or new.revision is distinct from old.revision + 1 then
      raise exception 'CONFLITO_REVISAO: use write_agenda_snapshot com a revisão esperada';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_agenda_snapshot_revision() from public, anon, authenticated;
drop trigger if exists agenda_snapshot_revision_guard on public.agenda_snapshots;
create trigger agenda_snapshot_revision_guard before insert or update on public.agenda_snapshots
for each row execute function public.guard_agenda_snapshot_revision();
commit;
