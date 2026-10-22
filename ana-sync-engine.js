/* Núcleo de sincronização por snapshot. Sem DOM, credenciais ou acesso a storage global. */
(() => {
  'use strict';
  const clone = value => structuredClone(value);
  const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const equal = (a, b) => canonical(a) === canonical(b);
  function validate(data) {
    if (!data || !Array.isArray(data.clients) || !Array.isArray(data.appointments) ||
        !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      throw new Error('Snapshot inválido: clientes, atendimentos e configurações são obrigatórios.');
    }
    return clone(data);
  }
  class Engine {
    constructor(options) {
      this.options = options;
      this.data = validate(options.data);
      this.meta = clone(options.meta || { owner: null, revision: null, base: null, dirty: true, attempt: null });
      this.enabled = false; // Consentimento sempre renovado ao abrir/reautenticar.
      this.user = null;
      this.generation = 0;
      this.epoch = 0;
      this.paused = false;
      this.choice = null;
      this.saving = Promise.resolve();
      this.operation = Promise.resolve();
      this.status('Alterações pendentes', 'Sincronização desativada.');
    }
    status(name, message = '') { this.currentStatus = name; this.options.status?.(name, message); }
    view() { return { data: clone(this.data), meta: clone(this.meta), enabled: this.enabled, paused: this.paused }; }
    persist() {
      const data = clone(this.data), meta = clone(this.meta);
      // Cada operação tem seu próprio snapshot; uma gravação antiga nunca captura estado futuro.
      const task = this.saving.then(() => this.options.persist(data, meta));
      this.saving = task.catch(error => { this.paused = true; this.status('Erro', 'Falha no armazenamento local: ' + error.message); });
      return task;
    }
    async localChanged(data) {
      validate(data);
      if (equal(data, this.data)) return this.saving;
      this.data = clone(data); this.generation += 1; this.choice = null;
      this.meta.dirty = true;
      this.status(this.paused ? 'Conflito' : this.options.online() ? 'Alterações pendentes' : 'Offline', 'Alterações locais preservadas.');
      await this.persist();
      if (this.enabled && !this.paused) this.options.schedule?.();
    }
    serialize(action) {
      const result = this.operation.then(action);
      this.operation = result.catch(() => {});
      return result;
    }
    requireUser() {
      if (!this.user) throw new Error('Faça login antes de acessar a agenda remota.');
      if (this.meta.owner && this.meta.owner !== this.user) throw new Error('Cópia local vinculada a outra conta. Use outro perfil de testes.');
      if (!this.options.online()) { this.status('Offline', 'Alterações locais preservadas; aguarde conexão.'); throw new Error('Conexão indisponível.'); }
    }
    async authenticate(user) {
      this.disable(); this.user = user;
      this.requireUser();
      return this.inspect();
    }
    disable() {
      this.enabled = false; this.epoch += 1; this.choice = null;
      this.status(this.options.online() ? 'Alterações pendentes' : 'Offline', 'Sincronização desativada; nenhuma nova transmissão será iniciada.');
    }
    signOut() { this.disable(); this.user = null; }
    conflict(message) {
      this.paused = true; this.choice = null;
      this.status('Conflito', message + ' Cópia local preservada. Escolha uma fonte para recuperar.');
    }
    async read() {
      this.requireUser();
      const remote = await this.options.read(this.user);
      if (remote) {
        validate(remote.payload);
        if (!Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new Error('Revisão remota inválida.');
      }
      return remote;
    }
    inspect() {
      return this.serialize(async () => {
        const epoch = this.epoch;
        const remote = await this.read();
        if (epoch !== this.epoch) throw new Error('Operação interrompida; verifique novamente.');
        this.remote = remote;
        const message = remote ? `Revisão remota ${remote.revision}.` : 'Ainda não há agenda remota.';
        if (this.enabled && (remote?.revision ?? 0) !== this.meta.revision) this.conflict('A revisão remota mudou.');
        else this.status(this.paused ? 'Conflito' : this.enabled && !this.meta.dirty ? 'Sincronizado' : 'Alterações pendentes',
          message + (this.enabled ? '' : ' Escolha Ativar sincronização para continuar.'));
        return remote;
      });
    }
    prepare() {
      return this.serialize(async () => {
        await this.saving;
        const epoch = this.epoch, generation = this.generation;
        const remote = await this.read();
        if (epoch !== this.epoch || generation !== this.generation) throw new Error('Dados alterados durante a consulta. Verifique novamente.');
        this.choice = { remote: clone(remote), generation, epoch };
        return { different: !!remote && !equal(remote.payload, this.data), revision: remote?.revision ?? 0 };
      });
    }
    choose(source) {
      return this.serialize(async () => {
        if (!['local', 'remote'].includes(source) || !this.choice) throw new Error('Verifique as fontes antes de escolher.');
        const decision = this.choice;
        if (decision.generation !== this.generation || decision.epoch !== this.epoch) throw new Error('Decisão expirada. Verifique novamente.');
        const remote = await this.read();
        if (decision.generation !== this.generation || decision.epoch !== this.epoch) throw new Error('Decisão expirada. Verifique novamente.');
        if (!equal(remote, decision.remote)) { this.conflict('A fonte remota mudou durante a decisão.'); return false; }
        if (source === 'remote' && !remote) throw new Error('Não existe cópia remota.');
        // Persistir uma cópia anterior antes de qualquer substituição explícita.
        await this.options.archive?.(clone(this.data), clone(this.meta));
        if (decision.generation !== this.generation || decision.epoch !== this.epoch) throw new Error('Decisão expirada. Verifique novamente.');
        if (source === 'remote') this.data = validate(remote.payload);
        this.meta = { owner: this.user, revision: remote?.revision ?? 0, base: remote?.payload ? clone(remote.payload) : null,
          dirty: !remote || !equal(this.data, remote.payload), attempt: null };
        this.paused = false; this.enabled = true; this.choice = null;
        await this.persist();
        if (source === 'remote') this.options.replace?.(clone(this.data));
        if (decision.epoch !== this.epoch || !this.enabled) return false;
        this.status(this.meta.dirty ? 'Alterações pendentes' : 'Sincronizado', `Revisão ${this.meta.revision}. Sincronização ativada.`);
        if (this.meta.dirty) this.options.schedule?.();
        return true;
      });
    }
    sync() {
      return this.serialize(async () => {
        if (!this.enabled || this.paused) return;
        if (!this.options.online()) { this.status('Offline', 'Alterações pendentes preservadas.'); return; }
        const epoch = this.epoch;
        try {
          await this.saving;
          if (this.paused || !this.enabled || epoch !== this.epoch) return;
          this.requireUser();
          this.status('Sincronizando', 'Verificando a revisão do servidor…');
          const remote = await this.read();
          if (!this.enabled || this.paused || epoch !== this.epoch) return;
          const revision = remote?.revision ?? 0;
          if (revision !== this.meta.revision || (remote && !equal(remote.payload, this.meta.base))) {
            // Resposta de escrita perdida: só reconhecer o conteúdo exato da tentativa registrada.
            if (this.meta.attempt && revision === this.meta.revision + 1 && equal(remote?.payload, this.meta.attempt)) {
              this.meta.revision = revision; this.meta.base = clone(remote.payload); this.meta.attempt = null;
              this.meta.dirty = !equal(this.data, remote.payload);
              await this.persist();
            } else { this.conflict('A revisão remota foi alterada por outra instância.'); return; }
          }
          if (!this.meta.dirty || equal(this.data, this.meta.base)) {
            this.meta.dirty = false; await this.persist();
            this.status('Sincronizado', `Revisão ${this.meta.revision} conferida no servidor.`); return;
          }
          const sent = clone(this.data), expected = this.meta.revision;
          this.meta.attempt = clone(sent);
          await this.persist(); // Journal durável antes de iniciar a requisição.
          if (!this.enabled || epoch !== this.epoch) return;
          const newRevision = await this.options.write(this.user, expected, sent);
          if (!Number.isSafeInteger(newRevision) || newRevision !== expected + 1) throw new Error('Servidor retornou revisão inesperada.');
          this.meta.revision = newRevision; this.meta.base = sent; this.meta.attempt = null;
          this.meta.dirty = !equal(this.data, sent);
          await this.persist();
          this.options.committed?.(newRevision);
          if (!this.enabled || epoch !== this.epoch) return;
          this.status(this.meta.dirty ? 'Alterações pendentes' : 'Sincronizado', `Revisão ${newRevision} confirmada pelo servidor.`);
          if (this.meta.dirty) this.options.schedule?.();
        } catch (error) {
          if (/CONFLITO_REVISAO|23505/.test(error.message || '') || error.code === '23505') this.conflict('Conflito na gravação; nada foi sobrescrito.');
          else this.status(this.options.online() ? 'Erro' : 'Offline', error.message + ' Alterações locais preservadas; tente novamente após verificar a conexão.');
        }
      });
    }
  }
  globalThis.AnaSync = { Engine, equal, validate };
})();
