(() => {
  'use strict';

  // Fluxo WebRTC adaptado de audioOnlyWebRtc.ts (revisão e licença no LEIA-ME.md).
  function install({ controls, startButton, muteButton, interruptButton, playbackButton, status, audio, onEvent, onState }) {
    let active;
    let closing = Promise.resolve();

    const startLabel = startButton.querySelector?.('[data-voice-label]') || startButton;
    const muteLabel = muteButton.querySelector?.('[data-voice-label]') || muteButton;

    function render(message = '') {
      startButton.setAttribute('aria-pressed', String(Boolean(active)));
      startLabel.textContent = active ? 'Encerrar voz' : 'Iniciar voz';
      muteButton.disabled = interruptButton.disabled = !active?.ready;
      muteButton.setAttribute('aria-pressed', String(Boolean(active?.muted)));
      muteLabel.textContent = active?.muted ? 'Ativar microfone' : 'Silenciar microfone';
      playbackButton.hidden = !active?.playbackBlocked;
      status.textContent = message;
    }

    function stop(message = '', drain = true) {
      const session = active;
      if (!session) return closing;
      active = undefined;
      session.request.abort();
      session.media?.getTracks().forEach(track => track.stop());
      session.peer?.close();
      audio.srcObject = null;
      if (!drain || !session.events) {
        session.events?.close();
        onEvent(session.agent, { type: 'closed' });
      }
      if (session.requested) {
        closing = fetch(session.url, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
      render(message);
      onState();
      return closing;
    }

    async function play(session) {
      try {
        await audio.play();
        if (active === session && session.playbackBlocked) {
          session.playbackBlocked = false;
          render(session.ready ? 'Microfone ligado.' : 'Conectando voz…');
        }
      } catch {
        if (active !== session) return;
        session.playbackBlocked = true;
        render('Toque em Ativar áudio para ouvir a resposta.');
      }
    }

    async function start(agent, context) {
      const id = crypto.randomUUID();
      const session = active = { agent, url: './api/voice/' + id, request: new AbortController() };
      render('Aguardando acesso ao microfone…');
      onState();
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (active !== session) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        session.media = media;
        session.track = media.getAudioTracks()[0];
        session.track.enabled = false;
        session.track.onended = () => {
          if (active === session) stop('Microfone indisponível. Você pode usar o chat escrito.');
        };
        render('Conectando voz…');
        const peer = session.peer = new RTCPeerConnection();
        peer.addTrack(session.track, media);
        peer.ontrack = ({ track, streams }) => {
          if (active !== session) return;
          audio.srcObject = streams[0] || new MediaStream([track]);
          void play(session);
        };
        peer.onconnectionstatechange = () => {
          if (active === session && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
            stop('A conexão de voz caiu. Confira a Agenda antes de repetir uma alteração.', false);
          }
        };
        await peer.setLocalDescription(await peer.createOffer());
        await closing;
        if (active !== session) return;
        session.requested = true;
        const response = await fetch('./api/voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, agent, sdp: peer.localDescription.sdp, ...context }),
          signal: AbortSignal.any([session.request.signal, AbortSignal.timeout(20_000)]),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (active !== session) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
        if (active !== session) return;
        const events = session.events = new EventSource(session.url + '/events');
        events.onmessage = ({ data }) => {
          const event = JSON.parse(data);
          if (event.type === 'ready' && active === session) {
            session.ready = true;
            session.track.enabled = true;
            render(session.playbackBlocked ? 'Toque em Ativar áudio para ouvir a resposta.' : 'Microfone ligado.');
          } else if (event.type === 'closed') {
            events.close();
            if (active === session) stop(event.message || 'Voz encerrada.', false);
            else onEvent(agent, event);
          } else if (event.type === 'closing') {
            if (active === session) stop(event.message || 'Voz encerrada.');
          } else if (event.type !== 'ready') onEvent(agent, event);
        };
        events.onerror = () => {
          events.close();
          if (active === session) stop('A conexão de voz caiu. Confira a Agenda antes de repetir uma alteração.', false);
          else onEvent(agent, { type: 'closed' });
        };
      } catch (error) {
        if (active !== session) return;
        stop(error.name === 'NotAllowedError' ? 'Permita o microfone ou continue pelo chat escrito.' :
          'Não foi possível iniciar a voz. Você pode usar o chat escrito.', false);
      }
    }

    controls.hidden = false;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection || !globalThis.EventSource) {
      startButton.disabled = true;
      render('Voz indisponível neste navegador. Você pode usar o chat escrito.');
      return;
    }
    muteButton.addEventListener('click', () => {
      if (!active?.ready) return;
      active.muted = !active.muted;
      active.track.enabled = !active.muted;
      render(active.muted ? 'Microfone silenciado.' : 'Microfone ligado.');
    });
    interruptButton.addEventListener('click', () => {
      if (!active?.ready) return;
      fetch(active.url + '/interrupt', { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
    });
    playbackButton.addEventListener('click', () => { if (active) void play(active); });
    globalThis.addEventListener('pagehide', () => stop('', false));
    return { start, stop, get active() { return Boolean(active); } };
  }

  globalThis.AgentVoice = Object.freeze({ install });
})();
