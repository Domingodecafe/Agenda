(() => {
  'use strict';
  const environment = window.AnaEnvironment;
  if (!environment?.isAllowed()) return;
  const list = document.getElementById('checks');
  let failures = 0;
  function check(name, passed, detail) {
    if (!passed) failures += 1;
    const item = document.createElement('li');
    item.textContent = `${passed ? 'OK' : 'PENDENTE'} — ${name}: ${detail}`;
    list.append(item);
  }
  async function run() {
    check('Origem e caminho exclusivos', environment.isAllowed(), location.origin + environment.basePath);
    const manifest = await fetch('./manifest.webmanifest').then(response => response.json());
    check('Identidade PWA', manifest.id === '/ana-dev/ana-secretaria-desenvolvimento' && manifest.scope === environment.basePath,
      `${manifest.name} · id ${manifest.id} · scope ${manifest.scope}`);
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    check('IndexedDB Ana criado', databases.some(database => database.name === environment.database),
      environment.database + ' (somente lista de nomes; nenhum banco original aberto)');
    check('Chaves de configuração e sessão exclusivas',
      [environment.fallbackKey, environment.cloudConfigKey, environment.authStorageKey].every(key => key.startsWith('ana-dev-')),
      [environment.fallbackKey, environment.cloudConfigKey, environment.authStorageKey].join(' · '));
    const registration = await navigator.serviceWorker.getRegistration(environment.basePath);
    const scope = environment.origin + environment.basePath;
    check('Escopo e script do worker', registration?.scope === scope && registration?.active?.scriptURL === scope + 'sw-ana-dev.js',
      registration?.active ? registration.scope + ' · ' + registration.active.scriptURL : 'Abra Ana DEV e recarregue esta página.');
    const hasCache = await caches.has(environment.cacheName);
    const cache = hasCache ? await caches.open(environment.cacheName) : null;
    const requests = cache ? await cache.keys() : [];
    check('Cache exclusivo', hasCache && requests.length === 8 && requests.every(request => request.url.startsWith(scope)),
      `${environment.cacheName} · ${requests.length}/8 arquivos no caminho Ana`);
    document.getElementById('result').textContent = failures
      ? `Verificação concluída com ${failures} item(ns) pendente(s).`
      : 'Isolamento local verificado: 6 verificações aprovadas.';
  }
  run().catch(error => { document.getElementById('result').textContent = 'Não foi possível concluir: ' + error.message; });
})();
