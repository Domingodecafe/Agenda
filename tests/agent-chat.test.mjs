import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAgentChat } from '../agent-chat-server.mjs';

const origin = 'http://127.0.0.1:43188';
const message = text => ({ type: 'message', content: [{ type: 'output_text', text }] });

async function harness(t, replies, configured = true) {
  const requests = [];
  const server = http.createServer(createAgentChat({
    origin,
    apiKey: configured ? 'test-key' : '',
    model: 'test-model',
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

test('Ana e Fin só recebem os fatos da ferramenta autorizada e o token só vale uma vez', async t => {
  const cases = [
    ['ana', 'consultar_horarios', { data: '2026-11-08' }, { starts: [] }, { data: '2026-11-08', horarios: [] }],
    ['fin', 'consultar_recebimentos', { mes: '2026-11' }, { receivedCents: 0 }, { mes: '2026-11', recebidoEmCentavos: 0 }],
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
