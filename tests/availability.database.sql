-- Fixtures exclusivamente fictícias; todas as alterações são revertidas no final.
begin;
do $test$
declare
  owner_uid uuid;
  other_uid uuid := gen_random_uuid();
  initial_revision bigint;
  fixture jsonb;
  result jsonb;
  expected record;
  rejected boolean;
begin
  select owner_id,revision into owner_uid,initial_revision from public.agenda_snapshots
    where payload->'clients'->0->>'id'='c1db2559-eb2b-469f-aa38-d5c683b3fae1'
    and not exists(select 1 from jsonb_array_elements(payload->'clients') c where c->>'name' not like 'TESTE%');
  if owner_uid is null then raise exception 'FIXTURE_FICTICIA_NAO_CONFIRMADA'; end if;
  fixture := jsonb_build_object('clients',jsonb_build_array(jsonb_build_object('name','TESTE_NOME_SIGILOSO','phone','FICTICIO_TELEFONE','notes','FICTICIO_OBSERVACAO','defaultValue',999123)),
    'settings','{}'::jsonb,'appointments','[
      {"kind":"appointment","date":"2026-11-03","start":"09:30","end":"10:15","clientName":"TESTE_NOME_SIGILOSO","value":999123},
      {"kind":"block","date":"2026-11-03","start":"14:00","end":"15:00","label":"FICTICIO_BLOQUEIO_PRIVADO"},
      {"kind":"appointment","date":"2026-11-03","start":"16:00","end":"17:00","recurrence":"weekly","seriesId":"FICTICIO_SERIE"},
      {"kind":"appointment","date":"2026-11-10","start":"16:00","end":"17:00","recurrence":"weekly","seriesId":"FICTICIO_SERIE"},
      {"kind":"appointment","date":"2026-11-03","start":"17:00","end":"18:00","status":"Cancelado"},
      {"kind":"appointment","date":"2026-11-09","start":"14:00","end":"19:00"}
    ]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated','is_anonymous',false)::text,true);
  execute 'set local role authenticated';
  update public.agenda_snapshots set payload=fixture,revision=revision+1 where owner_id=owner_uid;
  for expected in select * from (values
    (date '2026-11-02',5),(date '2026-11-03',5),(date '2026-11-04',9),
    (date '2026-11-05',9),(date '2026-11-06',5),(date '2026-11-07',4),
    (date '2026-11-08',0),(date '2026-11-09',0),(date '2026-11-10',8)
  ) as e(day,count_slots) loop
    result := public.consultar_disponibilidade(expected.day,expected.day);
    if jsonb_array_length(result->'dias'->0->'horarios') <> expected.count_slots then raise exception 'FALHA_EXPEDIENTE_OU_OCUPACAO: %',expected.day; end if;
    if result::text ~ 'TESTE_NOME|FICTICIO_|999123|clientName|phone|notes|payload|owner_id' then raise exception 'VAZAMENTO_DE_DADOS'; end if;
    if (result->>'revisao')::bigint <> initial_revision+1 then raise exception 'REVISAO_INCORRETA'; end if;
  end loop;
  result := public.consultar_disponibilidade(date '2026-11-03',date '2026-11-03');
  if jsonb_path_query_array(result,'$.dias[0].horarios[*].inicio') <> '["08:00","11:00","15:00","17:00","18:00"]'::jsonb then raise exception 'FALHA_SOBREPOSICAO_PARCIAL_ADJACENCIA_CANCELAMENTO'; end if;
  if (result->'dias'->0->'horarios'->2->>'inicio_utc')::timestamptz <> timestamptz '2026-11-03 18:00:00+00' then raise exception 'FALHA_FUSO_SP'; end if;
  result := public.consultar_disponibilidade(date '2000-01-04',date '2000-01-04');
  if (result->'dias'->0->'horarios'->0->>'inicio_utc')::timestamptz <> timestamptz '2000-01-04 10:00:00+00' then raise exception 'FALHA_FUSO_HISTORICO'; end if;
  result := public.consultar_disponibilidade(date '2026-11-02',date '2026-11-10');
  if jsonb_array_length(result->'dias') <> 9 then raise exception 'FALHA_PERIODO_INCLUSIVO'; end if;
  if (select revision from public.agenda_snapshots where owner_id=owner_uid) <> initial_revision+1 then raise exception 'API_MODIFICOU_SNAPSHOT'; end if;
  rejected:=false;
  begin perform public.consultar_disponibilidade(date '2026-11-01',date '2026-12-02');
  exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'LIMITE_PERIODO_NAO_APLICADO'; end if;
  rejected:=false;
  begin perform * from ana_private.availability_grants;
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'MAPEAMENTO_PRIVADO_EXPOSTO'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_uid,'role','authenticated')::text,true);
  if exists(select 1 from public.agenda_snapshots where owner_id=owner_uid) then raise exception 'RLS_EXPOS_OUTRO_USUARIO'; end if;
  rejected:=false;
  begin perform public.consultar_disponibilidade(date '2026-11-03',date '2026-11-03');
  exception when raise_exception then if sqlerrm='DISPONIBILIDADE_INDISPONIVEL' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'USUARIO_SEM_AGENDA_RECEBEU_HORARIOS'; end if;
  perform set_config('request.jwt.claims','{}',true);
  rejected:=false;
  begin perform public.consultar_disponibilidade(date '2026-11-03',date '2026-11-03');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'CHAMADA_SEM_IDENTIDADE_ACEITA'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated','is_anonymous',true)::text,true);
  rejected:=false;
  begin perform public.consultar_disponibilidade(date '2026-11-03',date '2026-11-03');
  exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'ANONYMOUS_AUTH_ACEITO'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
  update public.agenda_snapshots set payload=jsonb_set(fixture,'{appointments}','[{"kind":"appointment","date":"FICTICIO_INVALIDO","start":"09:00","end":"10:00"}]'),revision=revision+1 where owner_id=owner_uid;
  rejected:=false;
  begin perform public.consultar_disponibilidade(date '2026-11-03',date '2026-11-03');
  exception when raise_exception then if sqlerrm='DISPONIBILIDADE_INDISPONIVEL' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'DADOS_CORROMPIDOS_GERARAM_HORARIOS'; end if;
end;
$test$;
rollback;
select 'DISPONIBILIDADE_SQL_OK_FIXTURES_REVERTIDAS' as resultado;
