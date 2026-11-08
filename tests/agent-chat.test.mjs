import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAgentChat } from '../agent-chat-server.mjs';
import '../fin-core.js';
import '../agent-chat.js';

const origin = 'http://127.0.0.1:43188';
const message = text => ({ type: 'message', content: [{ type: 'output_text', text }] });

async function harness(t, replies, configured = true, agenda) {
  const requests = [];
  const server = http.createServer(createAgentChat({
    origin,
    apiKey: configured ? 'test-key' : '',
    model: 'test-model',
    agenda,
    fetchResponse: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      const next = replies.shift();
      if (next instanceof Response) return next;
      if (typeof next === 'number') return new Response(null, { status: next });
      return Response.json({ status: 'completed', output: next });
    },
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function post(data, requestOrigin = origin) {
    const response = await fetch('http://127.0.0.1:' + server.address().port, {
      method: 'POST',
      headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  return { post, requests };
}

test('Ana só recebe os fatos da ferramenta autorizada e o token só vale uma vez', async t => {
  const cases = [
    ['ana', 'consultar_horarios', { data: '2026-11-08' }, { starts: [] }, { data: '2026-11-08', horarios: [] }],
  ];
  for (const [agent, name, args, result, facts] of cases) {
    const toolCall = { type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'call_1' };
    const { post, requests } = await harness(t, [[toolCall], [message('Consulta concluída.')]]);
    const start = await post({ agent, message: 'Consulta de teste', history: [] });
    assert.equal(start.status, 200);
    assert.equal(start.body.period, Object.values(args)[0]);
    assert.deepEqual(requests[0].tools.map(tool => tool.name), agent === 'ana' ? [name, 'agendar_atendimento'] : [name]);
    const end = await post({ id: start.body.id, result: { ...result, privateNote: 'sentinela' } });
    assert.deepEqual(end, { status: 200, body: { reply: 'Consulta concluída.' } });
    assert.equal(requests[1].store, false);
    const output = requests[1].input.at(-1);
    assert.equal(output.call_id, 'call_1');
    assert.deepEqual(JSON.parse(output.output), facts);
    assert.equal((await post({ id: start.body.id, result })).status, 409);
  }
});

test('Ana prepara lote direto sem chamar o modelo e usa só uma chamada para filtros interpretados', async t => {
  const token = '12345678-1234-1234-1234-123456789abc';
  const filters = { names: ['Lia'], from: '2026-11-01', through: '2026-11-30', weekdays: [3], start: null,
    throughTime: null, recurrence: null, payment: 'paid' };
  const selections = [];
  const { post, requests } = await harness(t, [[{
    type: 'function_call', name: 'revisar_exclusao_em_lote', call_id: 'bulk', arguments: JSON.stringify(filters),
  }]], true, {
    bulkRemoval: async selection => {
      selections.push(selection);
      return { reply: 'Revise o lote.', confirmation: token };
    },
    continueRemoval: async (provided, recurringOnly) => {
      assert.equal(provided, token);
      assert.equal(recurringOnly, true);
      return { reply: 'Revise o lote recorrente.' };
    },
  });
  const input = { agent: 'ana', history: [] };
  assert.equal((await post({ ...input, message: 'Apague tudo das quartas até o fim do ano' })).body.confirmation, token);
  assert.deepEqual(selections[0].weekdays, [3]);
  assert.equal((await post({ ...input, message: 'Sim, apague a série inteira', pendingRemoval: token })).body.reply, 'Revise o lote recorrente.');
  assert.equal(requests.length, 0);
  assert.equal((await post({ ...input, message: 'Apague os atendimentos já pagos da Lia que caem nas quartas de novembro' })).body.confirmation, token);
  assert.deepEqual(selections[1], filters);
  assert.equal(requests.length, 1);
});

test('Diagnóstico da OpenAI distingue chave, acesso ao modelo e saldo sem expor a resposta original', async t => {
  const upstream = (status, code) => Response.json({ error: { code, message: 'sentinela-secreta' } }, { status });
  const { post } = await harness(t, [
    upstream(401, 'invalid_api_key'), upstream(403, null), upstream(404, 'model_not_found'),
    upstream(429, 'credit_balance_exhausted'),
  ]);
  const input = { agent: 'ana', message: 'Quais horários estão livres amanhã?', history: [] };
  for (const expected of [/invalid_api_key/, /negou acesso \(403\)/, /model_not_found/, /credit_balance_exhausted/]) {
    const { status, body } = await post(input);
    assert.equal(status, 503);
    assert.match(body.error, expected);
    assert.doesNotMatch(body.error, /sentinela-secreta/);
  }
});

test('Chat repete somente resposta incompleta por tokens e bloqueia fragmentos internos', async t => {
  const incomplete = () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
    output: [{ type: 'function_call', name: 'agendar_atendimento', arguments: '{' }] });
  const { post, requests } = await harness(t, [
    incomplete(), [message('Qual é a data?')],
    incomplete(), incomplete(),
    [message('Vou agendar. </commentary to=functions.agendar_atendimento')],
  ]);
  const input = { agent: 'ana', message: 'Agende uma sessão', history: [] };
  assert.deepEqual(await post(input), { status: 200, body: { reply: 'Qual é a data?' } });
  assert.ok(requests[1].max_output_tokens > requests[0].max_output_tokens);
  assert.match((await post(input)).body.error, /limite de geração/);
  const leaked = await post(input);
  assert.equal(leaked.status, 502);
  assert.doesNotMatch(leaked.body.error, /commentary|to=functions/);
  assert.equal(requests.length, 5);
});

test('Só a Ana pode solicitar um agendamento completo e o servidor não anuncia a gravação', async t => {
  const booking = (args) => ({
    type: 'function_call', name: 'agendar_atendimento', call_id: 'call_booking', arguments: JSON.stringify(args),
  });
  const args = { nome: 'Geraldinho Teste', data: '2026-11-13', horario: '18:00', modalidade: null };
  const { post, requests } = await harness(t, [
    [message('Em qual dia e horário?')], [booking(args)], [booking(args)], [booking({ ...args, horario: '25:00' })],
  ]);
  const input = { agent: 'ana', message: 'Marque um atendimento para Geraldinho Teste', history: [] };
  assert.deepEqual(await post(input), { status: 200, body: { reply: 'Em qual dia e horário?' } });
  assert.deepEqual(await post({ ...input, message: 'Dia 13 às 18h', history: [{ role: 'user', content: input.message }] }), {
    status: 200, body: { booking: { name: args.nome, date: args.data, start: args.horario, modality: 'Presencial' } },
  });
  assert.equal(requests.length, 2);
  assert.equal((await post({ ...input, agent: 'fin' })).status, 502);
  assert.equal((await post(input)).status, 502);
});

test('Chat rejeita outra origem, informa falhas da API e aceita uma recusa sem ferramenta', async t => {
  const { post, requests } = await harness(t, [429, [message('Só faço consultas.')]]);
  const input = { agent: 'ana', message: 'Marque uma sessão', history: [] };
  assert.equal((await post(input, 'https://example.com')).status, 403);
  assert.equal(requests.length, 0);
  assert.equal((await post(input)).status, 503);
  assert.deepEqual(await post(input), { status: 200, body: { reply: 'Só faço consultas.' } });
  const unconfigured = await harness(t, [], false);
  assert.match((await unconfigured.post(input)).body.error, /OPENAI_API_KEY/);
});

test('Fin consulta segundas e terças com o critério escolhido e responde usando apenas os totais da Agenda', async t => {
  const now = new Date('2026-11-25T15:00:00Z');
  const session = (id, date, value, financialStatus, extra = {}) => ({
    id, kind: 'appointment', date, value, end: '15:00', financialStatus, ...extra,
  });
  const state = { clients: [], appointments: [
    session('paga', '2026-11-02', 100, 'Pago', { payment: { date: '2026-11-03' } }),
    session('em-aberto', '2026-11-09', 80, 'A receber'),
    session('futura', '2026-11-30', 40, 'Não pago'),
    session('cancelada', '2026-11-16', 50, 'Não pago', { cancelled: true }),
    session('cancelada-paga', '2026-11-23', 70, 'Pago', { cancelled: true, payment: { date: '2026-11-23' } }),
    session('sem-data', '2026-11-23', 20, 'Pago'),
  ] };
  const cases = [
    ['Quanto vou receber nas segunda-ferias de novembro?', 'total', 1, /segundas-feiras de novembro de 2026.*240,00/],
    ['E nas terças?', 'total', 2, /terças-feiras de novembro de 2026.*sem registros/],
    ['Quanto entra nas segundas?', 'open', 1, /data do atendimento.*120,00/],
    ['Quanto já recebi nas terças?', 'received', 2, /data do pagamento.*100,00/],
    ['Quanto deu novembro?', 'both', null, /170,00.*120,00/],
  ];
  const outputs = cases.map(([, criterio, dia_da_semana]) => [{
    type: 'function_call', name: 'consultar_recebimentos', call_id: 'fin',
    arguments: JSON.stringify({ mes: '2026-11', criterio, dia_da_semana }),
  }]);
  const { post, requests } = await harness(t, outputs, true, {
    consult: (agent, period, filters) => AgentChat.consult(agent, period, state, now, filters),
  });
  const history = [];
  for (const [query, , , expected] of cases) {
    const response = await post({ agent: 'fin', message: query, history });
    assert.equal(response.status, 200);
    assert.match(response.body.reply, expected);
    history.push({ role: 'user', content: query }, { role: 'assistant', content: response.body.reply });
  }
  assert.equal(requests.length, cases.length);
  assert.deepEqual(requests[1].input.slice(0, 2), history.slice(0, 2));
  assert.deepEqual(requests[0].tools[0].parameters.required, ['mes', 'dia_da_semana', 'criterio']);
  assert.match(requests[0].instructions, /segunda-ferias/);
});

test('Fin local preserva o filtro e consome o token após responder', async t => {
  const { post } = await harness(t, [[{
    type: 'function_call', name: 'consultar_recebimentos', call_id: 'fin',
    arguments: JSON.stringify({ mes: '2026-11', criterio: 'open', dia_da_semana: 1 }),
  }]]);
  const start = await post({ agent: 'fin', message: 'Quanto entra nas segundas?', history: [] });
  assert.equal(start.status, 200);
  assert.deepEqual(start.body.filters, { mode: 'open', weekday: 1 });
  const finish = { id: start.body.id, result: { openCents: 0, openCount: 0 } };
  assert.match((await post(finish)).body.reply, /segundas-feiras.*sem registros/);
  assert.equal((await post(finish)).status, 409);
});
