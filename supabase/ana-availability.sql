-- Aula 3.7: somente Secretaria Ana DEV. Sem alteração de snapshots ou usuários.
begin;
create schema if not exists ana_private;
revoke all on schema ana_private from public, anon, authenticated;
grant usage on schema ana_private to authenticated;
alter default privileges in schema ana_private revoke execute on functions from public;

-- Provisionamento futuro somente pelo administrador; nunca pelo agente/navegador.
create table if not exists ana_private.availability_grants (
  actor_id uuid primary key references auth.users(id) on delete cascade,
  agenda_owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table ana_private.availability_grants enable row level security;
revoke all on ana_private.availability_grants from public, anon, authenticated;
drop policy if exists availability_grants_deny_api on ana_private.availability_grants;
create policy availability_grants_deny_api on ana_private.availability_grants as restrictive
  for all to anon, authenticated using (false) with check (false);

-- SECURITY DEFINER intencional: projeta disponibilidade de uma agenda autorizada,
-- sem entregar o documento à Edge Function. Nenhum owner_id é recebido do cliente.
create or replace function ana_private.consultar_disponibilidade(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner uuid;
  v_payload jsonb;
  v_revision bigint;
  v_item jsonb;
  v_date date;
  v_start integer;
  v_end integer;
  v_busy jsonb := '[]'::jsonb;
  v_days jsonb := '[]'::jsonb;
  v_slots jsonb;
  v_day date;
  v_dow integer;
  v_window record;
  v_minute integer;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
    raise exception using errcode='42501', message='NAO_AUTORIZADO';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim-p_inicio > 30
    or p_inicio < date '1900-01-01' or p_fim > date '2100-12-31' then
    raise exception using errcode='22023', message='PERIODO_INVALIDO';
  end if;
  select g.agenda_owner_id into v_owner from ana_private.availability_grants g where g.actor_id=v_actor;
  v_owner := coalesce(v_owner,v_actor);
  select s.revision, s.payload into v_revision,v_payload from public.agenda_snapshots s where s.owner_id=v_owner;
  if not found or jsonb_typeof(v_payload->'appointments') is distinct from 'array'
    or jsonb_array_length(v_payload->'appointments') > 20000 then
    raise exception 'DISPONIBILIDADE_INDISPONIVEL';
  end if;
  -- Falha fechada: registros ilegíveis não são descartados como se fossem livres.
  for v_item in select value from jsonb_array_elements(v_payload->'appointments') loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or coalesce(v_item->>'kind','') not in ('appointment','block')
      or coalesce(v_item->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(v_item->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(v_item->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'DISPONIBILIDADE_INDISPONIVEL';
    end if;
    v_date := (v_item->>'date')::date;
    v_start := split_part(v_item->>'start',':',1)::integer*60 + split_part(v_item->>'start',':',2)::integer;
    v_end := split_part(v_item->>'end',':',1)::integer*60 + split_part(v_item->>'end',':',2)::integer;
    if v_end <= v_start then raise exception 'DISPONIBILIDADE_INDISPONIVEL'; end if;
    if v_date between p_inicio and p_fim
      and lower(coalesce(v_item->>'status','')) not in ('cancelado','cancelada','cancelled','canceled') then
      v_busy := v_busy || jsonb_build_array(jsonb_build_object('day',v_date,'start_min',v_start,'end_min',v_end));
    end if;
  end loop;
  for v_day in select d::date from generate_series(p_inicio::timestamp,p_fim::timestamp,interval '1 day') d order by 1 loop
    v_slots := '[]'::jsonb;
    v_dow := extract(isodow from v_day)::integer;
    for v_window in
      select * from (values (480,720),(840,1140)) as w(start_min,end_min)
      where (v_dow in (2,3,4)) or (v_dow in (1,5) and w.start_min=840) or (v_dow=6 and w.start_min=480)
      order by w.start_min
    loop
      for v_minute in v_window.start_min..v_window.end_min-60 by 60 loop
        if not exists(select 1 from jsonb_to_recordset(v_busy) as b(day date,start_min integer,end_min integer)
          where b.day=v_day and b.start_min < v_minute+60 and b.end_min > v_minute) then
          v_slots := v_slots || jsonb_build_array(jsonb_build_object(
            'inicio',to_char(v_day+make_interval(mins=>v_minute),'HH24:MI'),
            'fim',to_char(v_day+make_interval(mins=>v_minute+60),'HH24:MI'),
            'inicio_utc',(v_day+make_interval(mins=>v_minute)) at time zone 'America/Sao_Paulo',
            'fim_utc',(v_day+make_interval(mins=>v_minute+60)) at time zone 'America/Sao_Paulo'
          ));
        end if;
      end loop;
    end loop;
    v_days := v_days || jsonb_build_array(jsonb_build_object('data',v_day,'horarios',v_slots));
  end loop;
  return jsonb_build_object('revisao',v_revision,'dias',v_days);
exception
  when insufficient_privilege then raise exception using errcode='42501',message='NAO_AUTORIZADO';
  when invalid_parameter_value then raise exception using errcode='22023',message='PERIODO_INVALIDO';
  when others then raise exception 'DISPONIBILIDADE_INDISPONIVEL';
end;
$$;
revoke all on function ana_private.consultar_disponibilidade(date,date) from public,anon;
grant execute on function ana_private.consultar_disponibilidade(date,date) to authenticated;

create or replace function public.consultar_disponibilidade(p_inicio date,p_fim date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select ana_private.consultar_disponibilidade(p_inicio,p_fim);
$$;
revoke all on function public.consultar_disponibilidade(date,date) from public,anon;
grant execute on function public.consultar_disponibilidade(date,date) to authenticated;
commit;
