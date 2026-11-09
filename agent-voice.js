(() => {
  'use strict';

  // Fluxo WebRTC adaptado de audioOnlyWebRtc.ts (revisão e licença no LEIA-ME.md).
  function install({ controls, startButton, muteButton, interruptButton, playbackButton, status, audio, holdButton, onEvent, onState, onStatus }) {
    let active;
    let closing = Promise.resolve();

    const startLabel = startButton.querySelector?.('[data-voice-label]') || startButton;
    const muteLabel = muteButton?.querySelector?.('[data-voice-label]') || muteButton;

    function render(message = '') {
      startButton.setAttribute('aria-pressed', String(Boolean(active)));
      startLabel.textContent = active?.playbackBlocked ? 'Ativar áudio' :
        !active ? 'Falar' : active.ready ? 'Encerrar' : 'Conectando…';
      if (muteButton) {
        muteButton.disabled = !active?.ready;
        muteButton.setAttribute('aria-pressed', String(Boolean(active?.muted)));
        muteLabel.textContent = active?.muted ? 'Ativar microfone' : 'Silenciar microfone';
      }
      if (interruptButton) interruptButton.disabled = !active?.ready;
      if (playbackButton) playbackButton.hidden = !active?.playbackBlocked;
      if (holdButton) {
        holdButton.hidden = active?.mode !== 'hold';
        holdButton.disabled = !active?.ready || Boolean(active.muted);
        holdButton.setAttribute('aria-pressed', String(Boolean(active?.capture && !active.capture.ending)));
      }
      status.textContent = message;
      onStatus?.({
        active: Boolean(active), ready: Boolean(active?.ready), muted: Boolean(active?.muted),
        playbackBlocked: Boolean(active?.playbackBlocked), mode: active?.mode, message,
      });
    }

    function stop(message = '', drain = true) {
      const session = active;
      if (!session) return closing;
      active = undefined;
      session.request.abort();
      clearTimeout(session.capture?.timer);
      session.media?.getTracks().forEach(track => track.stop());
      session.peer?.close();
      audio.srcObject = null;
      if (!drain || !session.events) {
        session.events?.close();
        onEvent(session.agent, { type: 'closed', session: session.url });
      }
      if (session.requested) {
        closing = fetch(session.url, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
      render(message);
      onState();
      return closing;
    }

    async function recover(session) {
      if (session.recovering) return;
      session.recovering = true;
      onEvent(session.agent, { type: 'disconnected', session: session.url });
      const deadline = Date.now() + 600_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(session.url + '/turns', { signal: AbortSignal.timeout(5000) });
          if (response.status === 404 || response.status === 401) break;
          if (response.ok) {
            const { turns, closed } = await response.json();
            for (const turn of turns) {
              onEvent(session.agent, { type: 'turn', id: turn.id, message: turn.message, session: session.url });
              if (turn.state === 'completed') onEvent(session.agent, { ...turn, type: 'result', session: session.url });
            }
            if (closed && turns.every(turn => turn.state === 'completed')) {
              onEvent(session.agent, { type: 'recovery-complete', session: session.url });
              return;
            }
          }
        } catch { /* A rede pode voltar enquanto a aba permanece aberta. */ }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      onEvent(session.agent, { type: 'recovery-unknown', session: session.url });
    }

    function loseConnection(session) {
      if (active === session) stop('A conexão de voz caiu.', false);
      else session.events?.close();
      void recover(session);
    }

    const captureRequest = (session, action) => fetch(session.url + '/capture/' + action, {
      method: 'POST', signal: AbortSignal.timeout(5000),
    });

    async function beginCapture() {
      const session = active;
      if (!session?.ready || session.mode !== 'hold' || session.muted || session.capture) return;
      const capture = session.capture = {};
      capture.arming = captureRequest(session, 'start');
      render('Preparando microfone…');
      try {
        const response = await capture.arming;
        if (!response.ok) throw new Error('Capture unavailable');
        if (active === session && session.capture === capture && !capture.ending) {
          capture.started = Date.now();
          capture.timer = setTimeout(() => void endCapture(true), 60_000);
          session.track.enabled = true;
          render('Ouvindo…');
        }
      } catch {
        if (active !== session || session.capture !== capture || capture.ending) return;
        session.capture = undefined;
        render('Não foi possível abrir o microfone. Tente novamente.');
      }
    }

    async function endCapture(cancel = false) {
      const session = active;
      const capture = session?.capture;
      if (!capture) return;
      if (cancel && !capture.committing) capture.cancelled = true;
      if (capture.ending) return;
      capture.ending = true;
      clearTimeout(capture.timer);
      session.track.enabled = false;
      const commit = !cancel && capture.started && Date.now() - capture.started >= 150;
      render(commit ? 'Transcrevendo…' : 'Segure para falar.');
      try {
        await capture.arming;
        // A mídia e a sinalização viajam por conexões separadas.
        if (commit) await new Promise(resolve => setTimeout(resolve, 200));
        if (active !== session || session.capture !== capture) return;
        capture.committing = Boolean(commit && !capture.cancelled);
        const response = await captureRequest(session, capture.committing ? 'finish' : 'cancel');
        if (capture.committing && response.ok) return;
      } catch { /* O servidor descarta uma captura que não foi finalizada. */ }
      if (active !== session || session.capture !== capture) return;
      session.capture = undefined;
      render('Segure para falar.');
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

    async function start(agent, context, mode = 'continuous') {
      const id = crypto.randomUUID();
      const session = active = { agent, mode, url: './api/voice/' + id, request: new AbortController() };
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
            loseConnection(session);
          }
        };
        await peer.setLocalDescription(await peer.createOffer());
        await closing;
        if (active !== session) return;
        session.requested = true;
        const response = await fetch('./api/voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, agent, mode, sdp: peer.localDescription.sdp, ...context }),
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
            session.track.enabled = session.mode === 'continuous';
            render(session.playbackBlocked ? 'Toque em Ativar áudio para ouvir a resposta.' :
              session.mode === 'hold' ? 'Segure para falar.' : 'Microfone ligado.');
          } else if (event.type === 'speech-state' && active === session) {
            session.speaking = event.capturing;
          } else if (event.type === 'capture-ready' && active === session) {
            session.capture = undefined;
            render('Segure para falar.');
          } else if (event.type === 'closed') {
            events.close();
            if (event.recoverable) loseConnection(session);
            else if (active === session) stop(event.message || 'Voz encerrada.', false);
            else onEvent(agent, event);
          } else if (event.type === 'closing') {
            if (event.recoverable) loseConnection(session);
            else if (active === session) stop(event.message || 'Voz encerrada.');
          } else if (event.type !== 'ready') onEvent(agent, { ...event, session: session.url });
        };
        events.onerror = () => {
          events.close();
          loseConnection(session);
        };
      } catch (error) {
        if (active !== session) return;
        stop(error.name === 'NotAllowedError' ? 'Permita o microfone ou continue pelo chat escrito.' :
          'Não foi possível iniciar a voz. Você pode usar o chat escrito.', false);
      }
    }

    if (controls) controls.hidden = false;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection || !globalThis.EventSource) {
      startButton.disabled = true;
      render('Voz indisponível neste navegador. Você pode usar o chat escrito.');
      return;
    }
    muteButton?.addEventListener('click', () => {
      if (!active?.ready) return;
      active.muted = !active.muted;
      if (active.muted) void endCapture(true);
      active.track.enabled = !active.muted && active.mode === 'continuous';
      render(active.muted ? 'Microfone silenciado.' : 'Microfone ligado.');
    });
    interruptButton?.addEventListener('click', () => {
      if (!active?.ready) return;
      fetch(active.url + '/interrupt', { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
    });
    const resumeAudio = () => active && play(active);
    playbackButton?.addEventListener('click', resumeAudio);
    startButton.hidden = false;
    holdButton?.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      holdButton.setPointerCapture(event.pointerId);
      void beginCapture();
    });
    holdButton?.addEventListener('pointerup', event => {
      if (event.isPrimary) void endCapture();
    });
    holdButton?.addEventListener('lostpointercapture', () => {
      if (!active?.capture?.ending) void endCapture(true);
    });
    for (const type of ['pointercancel', 'blur']) {
      holdButton?.addEventListener(type, () => void endCapture(true));
    }
    holdButton?.addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (!event.repeat) void beginCapture();
    });
    holdButton?.addEventListener('keyup', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      void endCapture();
    });
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.hidden) void endCapture(true);
    });
    globalThis.addEventListener('pagehide', () => stop('', false));
    return { start, stop, resumeAudio, get active() { return Boolean(active); }, get capturing() { return Boolean(active?.capture || active?.speaking); } };
  }

  globalThis.AgentVoice = Object.freeze({ install });
})();
