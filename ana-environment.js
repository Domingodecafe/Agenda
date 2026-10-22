/* Ambiente exclusivo da Ana. Ampliar esta lista exige revisão antes de publicar. */
(() => {
  'use strict';
  const environment = Object.freeze({
    origin: 'http://127.0.0.1:43188',
    basePath: '/ana-dev/',
    database: 'ana-dev-agenda-db-v1',
    store: 'ana-dev-agenda',
    stateKey: 'ana-dev-main',
    fallbackKey: 'ana-dev-agenda-state-v1',
    fallbackMarker: 'ana-dev-agenda-fallback-active-v1',
    cloudConfigKey: 'ana-dev-supabase-config-v1',
    authStorageKey: 'ana-dev-supabase-auth-v1',
    draftPrefix: 'ana-dev-sync-draft-v1-',
    archivePrefix: 'ana-dev-sync-archive-v1-',
    cloudUrl: 'https://dpdxzbbzymkygutwefww.supabase.co',
    cacheName: 'ana-dev-pwa-v5',
    isAllowed(location = globalThis.location) {
      return location.origin === this.origin && location.pathname.startsWith(this.basePath);
    },
  });
  globalThis.AnaEnvironment = environment;
  if (typeof document !== 'undefined' && !environment.isAllowed()) {
    document.addEventListener('DOMContentLoaded', () => {
      const message = document.createElement('p');
      message.textContent = 'Ana DESENVOLVIMENTO bloqueada neste endereço. Abra http://127.0.0.1:43188/ana-dev/. Nenhum dado local foi carregado.';
      message.setAttribute('role', 'alert');
      document.body.replaceChildren(message);
    }, { once: true });
  }
})();
