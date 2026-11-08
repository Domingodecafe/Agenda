import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../agent-voice.js', import.meta.url), 'utf8');

function client({ getUserMedia } = {}) {
  const sessions = [];
  const requests = [];
  const tracks = [];
  const events = [];
  const sandbox = {
    AbortController, AbortSignal, crypto: globalThis.crypto,
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => {
      const track = { enabled: true, stop() { this.stopped = true; } };
      tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }) } },
    addEventListener() {},
    async fetch(url, options) {
      requests.push([url, options]);
      return { ok: true, json: async () => ({ sdp: 'answer' }) };
    },
    RTCPeerConnection: class {
      addTrack() {}
      async createOffer() { return { sdp: 'offer' }; }
      async setLocalDescription(offer) { this.localDescription = offer; }
      async setRemoteDescription() {}
      close() {}
    },
    EventSource: class {
      constructor(url) { this.url = url; sessions.push(this); }
      close() { this.closed = true; }
      receive(data) { this.onmessage({ data: JSON.stringify(data) }); }
    },
  };
  vm.runInNewContext(source, sandbox);
  const button = () => ({
    setAttribute() {},
    addEventListener(_event, callback) { this.click = callback; },
  });
  const muteButton = button();
  const status = {};
  const voice = sandbox.AgentVoice.install({
    controls: {}, startButton: button(), muteButton, interruptButton: button(), playbackButton: button(),
    status, audio: {}, onEvent: (...args) => events.push(args), onState() {},
  });
  return { voice, sessions, requests, tracks, events, muteButton, status };
}

test('troca de agente solta o microfone anterior e entrega o resultado ao agente correto', async () => {
  const { voice, sessions, requests, tracks, events, muteButton } = client();
  await voice.start('ana', { history: [] });
  assert.equal(tracks[0].enabled, false);
  sessions[0].receive({ type: 'ready' });
  assert.equal(tracks[0].enabled, true);
  muteButton.click();
  assert.equal(tracks[0].enabled, false);
  void voice.stop();
  await voice.start('fin', { history: [] });
  assert.equal(tracks[0].stopped, true);
  assert.equal(requests[1][1].method, 'DELETE');
  assert.equal(JSON.parse(requests[2][1].body).agent, 'fin');
  sessions[0].receive({ type: 'result', result: { reply: 'Agendado' } });
  assert.equal(events[0][0], 'ana');
  sessions[0].receive({ type: 'closed' });
  assert.equal(voice.active, true);
  sessions[1].onerror();
  assert.equal(tracks[1].stopped, true);
  assert.equal(voice.active, false);
});

test('permissão negada libera o chat e não abre uma sessão', async () => {
  const { voice, requests, status } = client({ async getUserMedia() {
    throw Object.assign(new Error(), { name: 'NotAllowedError' });
  } });
  await voice.start('ana', { history: [] });
  assert.equal(voice.active, false);
  assert.equal(requests.length, 0);
  assert.match(status.textContent, /chat escrito/);
});
