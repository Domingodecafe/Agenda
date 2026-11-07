/* Agenda somente leitura; despesas em banco próprio, com confirmação transacional. */
(() => {
  'use strict';
  const env = globalThis.AnaEnvironment;
  if (!env?.isAllowed()) return;
  function open(name, store, create) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        if (create) req.result.createObjectStore(store);
        else req.transaction.abort();
      };
      let blocked = false;
      req.onsuccess = () => { if (blocked) req.result.close(); else resolve(req.result); };
      req.onerror = () => reject(new Error('Armazenamento indisponível. Abra a Agenda e tente novamente.'));
      req.onblocked = () => { blocked = true; reject(new Error('Feche outras versões do painel e tente novamente.')); };
    });
  }
  async function transaction(db, storeName, mode, run) {
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let result, failure;
        try { run(tx.objectStore(storeName), value => { result = value; }, tx); }
        catch (error) { failure = error; tx.abort(); }
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Operação não gravada.'));
        tx.onerror = () => { /* onabort encerra a operação */ };
      });
    } finally { db.close(); }
  }
  async function agenda() {
    let value;
    if (localStorage.getItem(env.fallbackMarker) === 'active') {
      const raw = localStorage.getItem(env.fallbackKey);
      if (!raw) throw new Error('Fallback da Agenda ausente.');
      value = JSON.parse(raw);
    } else {
      const db = await open(env.database, env.store, false);
      value = await transaction(db, env.store, 'readonly', (store, done) => {
        const req = store.get(env.stateKey); req.onsuccess = () => done(req.result);
      });
    }
    const state = value?.anaLocalVersion === 1 ? value.state : value;
    if (!state) throw new Error('Salve um registro fictício na Agenda antes de abrir o Fin.');
    return FinCore.project(state);
  }
  // Mantém o banco/store e a chave de despesas v1. Dados novos ficam em outra chave.
  const name = 'fin-dev-finance-v1', storeName = 'ledger';
  async function access(command = null) {
    const db = await open(name, storeName, true);
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, command ? 'readwrite' : 'readonly'), store = tx.objectStore(storeName);
        let result, failure;
        const expensesRequest = store.get('expenses'), planningRequest = store.get('planning');
        planningRequest.onsuccess = () => {
          try {
            const defaults = FinLedger.empty();
            const ledger = FinLedger.normalize({ ...defaults, ...planningRequest.result, expenses: expensesRequest.result || [] });
            if (!command) { result = ledger; return; }
            const answer = FinLedger.apply(ledger, command);
            if (answer.state.revision !== ledger.revision) {
              if (command.type === 'backup.restore') store.put(FinLedger.backup(ledger), 'before-last-restore');
              const { expenses, ...planning } = answer.state;
              store.put(expenses, 'expenses'); store.put(planning, 'planning');
            }
            result = answer.result;
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Operação não gravada.'));
        tx.onerror = () => {};
      });
    } finally { db.close(); }
  }
  async function previousBackup() {
    const db = await open(name, storeName, true);
    return transaction(db, storeName, 'readonly', (store, done) => {
      const req = store.get('before-last-restore'); req.onsuccess = () => done(req.result || null);
    });
  }
  globalThis.FinStore = Object.freeze({ agenda, read: () => access(), expenses: async () => (await access()).expenses,
    addExpense: (input, requestId) => access({ type: 'expense.add', input, requestId }),
    addObligation: (input, requestId) => access({ type: 'obligation.add', input, requestId }),
    voidExpense: id => access({ type: 'expense.void', id }),
    payOccurrence: (occurrenceId, date, requestId) => access({ type: 'occurrence.pay', occurrenceId, date, requestId }),
    cancelOccurrence: occurrenceId => access({ type: 'occurrence.cancel', occurrenceId }),
    saveSettings: settings => access({ type: 'settings.save', settings }),
    restore: (backup, expectedRevision) => access({ type: 'backup.restore', backup, expectedRevision }), previousBackup });
})();
