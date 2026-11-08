import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createAgentChat } from '../agent-chat-server.mjs';
import { createVoiceHandler } from '../agent-voice-server.mjs';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const origin = 'https://agenda.test';

class Sideband extends EventTarget {
  readyState = 1;
  sent = [];
  send(data) {
    const event = JSON.parse(data);
    if (event.type === 'session.update') this.receive({ type: 'session.updated', session: event.session });
    else this.sent.push(event);
  }
  close() { this.readyState = 3; }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  transcript(item_id, transcript) {
    this.receive({ type: 'input_audio_buffer.speech_started', item_id });
    this.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id, transcript });
  }
}

async function setup(t, processTurn) {
  const sockets = [];
  const hangups = [];
  const voice = createVoiceHandler({
    origin, apiKey: 'test-key', model: 'test-model', processTurn,
    async fetchCall(_url, { body }) {
      const session = JSON.parse(body.get('session'));
      assert.equal(session.audio.input.turn_detection.create_response, false);
      assert.equal(session.audio.input.transcription.language, 'pt');
      return new Response(sdp, { headers: { Location: '/v1/realtime/calls/rtc_test' } });
    },
    connect() {
      const socket = new Sideband();
      sockets.push(socket);
      queueMicrotask(() => socket.dispatchEvent(new Event('open')));
      return socket;
    },
    hangup: id => hangups.push(id),
  });
  const server = createServer((req, res) => {
    req.agendaSession = req.headers['x-test-user'] || 'user';
    req.agendaSessionExpires = Date.now() + 60_000;
    void voice(req, res, req.url.slice(1));
  }).listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, options = {}) => fetch(base + '/' + path, {
    ...options, headers: { Origin: origin, ...options.headers }, signal: AbortSignal.timeout(3000),
  });
  const start = (id, agent = 'ana', extra = {}) => request('', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, agent, sdp, history: [], ...extra }),
  });
  async function events(id) {
    const response = await request(id + '/events');
    assert.equal(response.status, 200);
    const lines = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    return async () => {
      while (!buffer.includes('\n\n')) {
        const next = await lines.read();
        assert.equal(next.done, false);
        buffer += next.value;
      }
      const end = buffer.indexOf('\n\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return JSON.parse(line.slice(6));
    };
  }
  return { start, events, request, sockets, hangups };
}

test('voz rejeita SDP com canal de dados e controla sessão e interrupção por login', async t => {
  const turns = [];
  const app = await setup(t, async turn => {
    turns.push(turn);
    return { reply: 'Resultado da Agenda.' };
  });
  const id = randomUUID();
  assert.equal((await app.start(id, 'ana', { sdp: sdp + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' })).status, 400);
  assert.equal((await app.start(id)).status, 200);
  assert.equal((await app.start(randomUUID())).status, 409);
  assert.equal((await app.request(id + '/events', { headers: { 'x-test-user': 'other' } })).status, 404);
  const next = await app.events(id);
  assert.equal((await next()).type, 'ready');
  const [socket] = app.sockets;
  socket.transcript('item1', 'Quais horários estão livres?');
  socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item1', transcript: 'Repita' });
  assert.equal((await next()).type, 'turn');
  assert.equal((await next()).result.reply, 'Resultado da Agenda.');
  assert.equal(turns.length, 1);
  assert.match(JSON.stringify(socket.sent[0]), /Resultado da Agenda/);
  assert.equal((await app.request(id + '/interrupt', { method: 'POST' })).status, 204);
  assert.deepEqual(socket.sent.slice(1).map(event => event.type), ['response.cancel', 'output_audio_buffer.clear']);
  assert.equal((await app.request(id, { method: 'DELETE' })).status, 204);
  assert.equal((await next()).type, 'closed');
  assert.deepEqual(app.hangups, ['rtc_test']);

  const finId = randomUUID();
  assert.equal((await app.start(finId, 'fin', { history: [{ role: 'assistant', content: 'Recebimentos de outubro' }] })).status, 200);
  const finNext = await app.events(finId);
  await finNext();
  app.sockets[1].transcript('item1', 'E no mês passado?');
  await finNext();
  await finNext();
  assert.equal(turns[1].agent, 'fin');
  assert.equal(turns[1].history[0].content, 'Recebimentos de outubro');
  assert.equal((await app.request(finId, { method: 'DELETE' })).status, 204);
});

test('queda do áudio preserva o resultado em andamento e descarta comandos ainda na fila', async t => {
  const { promise, resolve } = Promise.withResolvers();
  let count = 0;
  const app = await setup(t, () => { count++; return promise; });
  const id = randomUUID();
  assert.equal((await app.start(id)).status, 200);
  const next = await app.events(id);
  await next();
  const [socket] = app.sockets;
  socket.transcript('first', 'Marque amanhã');
  socket.transcript('queued', 'Apague todos');
  assert.equal((await next()).message, 'Marque amanhã');
  socket.dispatchEvent(new Event('close'));
  assert.match((await next()).message, /confira a Agenda/);
  resolve({ reply: 'Agendado', changed: true });
  assert.equal((await next()).result.changed, true);
  assert.equal((await next()).type, 'closed');
  assert.equal(count, 1);
  assert.equal(socket.sent.length, 0);
});

test('confirmação falada chama a revisão e só o chat escrito recebe a operação de exclusão', async t => {
  const token = 'a'.repeat(36);
  let reviews = 0;
  const chat = createAgentChat({
    origin, apiKey: 'test', model: 'test',
    agenda: {
      continueRemoval(id) {
        assert.equal(id, token);
        reviews++;
        return { reply: 'Use o botão de confirmação.', showConfirmation: true };
      },
      confirmRemoval() { assert.fail('O áudio nunca deve efetivar a exclusão'); },
    },
    fetchResponse() { assert.fail('A confirmação falada deve encaminhar para o cartão'); },
  });
  const app = await setup(t, chat.processTurn);
  const id = randomUUID();
  assert.equal((await app.start(id, 'ana', { pendingRemoval: token })).status, 200);
  const next = await app.events(id);
  await next();
  app.sockets[0].transcript('1', 'Sim, confirmo.');
  await next();
  const { result } = await next();
  assert.equal(result?.showConfirmation, true);
  assert.equal(reviews, 1);
  await app.request(id, { method: 'DELETE' });
});
