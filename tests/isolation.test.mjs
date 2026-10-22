import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const environmentSource = await read('ana-environment.js');
const appSource = await read('app.js');
const cloudSource = await read('cloud-sync.js');
const workerSource = await read('sw-ana-dev.js');
const devURL = 'http://127.0.0.1:43188/ana-dev/';

function context(url = devURL, additions = {}) {
  const ctx = vm.createContext({
    location: new URL(url), URL, console, structuredClone, queueMicrotask,
    document: { addEventListener() {} }, ...additions
  });
  ctx.window = ctx;
  ctx.self = ctx;
  vm.runInContext(environmentSource, ctx);
  return ctx;
}

// Executa as funções reais de persistência, substituindo apenas o bootstrap da UI.
function persistenceContext({ failure = false } = {}) {
  const original = { clients: [{ name: 'SENTINELA FICTÍCIA ORIGINAL' }], appointments: [], settings: {} };
  const databases = new Map([['agenda-1-0-db', original]]);
  const local = new Map([['agenda-1-0-state', JSON.stringify(original)]]);
  const accesses = [];
  const ctx = context(devURL, {
    localStorage: {
      getItem(key) { accesses.push(['local-read', key]); return local.get(key) ?? null; },
      setItem(key, value) { accesses.push(['local-write', key]); local.set(key, value); }
    },
    indexedDB: {
      open(name) {
        accesses.push(['db-open', name]);
        const request = {};
        queueMicrotask(() => {
          if (failure) { request.error = new Error('IndexedDB indisponível'); request.onerror(); return; }
          request.result = {
            createObjectStore(store) { accesses.push(['db-create-store', store]); },
            transaction(store) {
              accesses.push(['db-store', store]);
              const transaction = {
                objectStore() {
                  return {
                    get(key) {
                      accesses.push(['db-get', key]);
                      const result = {};
                      queueMicrotask(() => { result.result = structuredClone(databases.get(name)); result.onsuccess(); });
                      return result;
                    },
                    put(value, key) {
                      accesses.push(['db-put', key]);
                      databases.set(name, structuredClone(value));
                      queueMicrotask(() => transaction.oncomplete());
                    }
                  };
                }
              };
              return transaction;
            },
            close() {}
          };
          if (!databases.has(name)) request.onupgradeneeded();
          request.onsuccess();
        });
        return request;
      }
    }
  });
  const bootstrap = appSource.indexOf('  init().then(async () => {');
  assert.ok(bootstrap > 0, 'Bootstrap identificado para testar persistência sem UI');
  vm.runInContext(appSource.slice(0, bootstrap) +
    'globalThis.persistence = {loadState, persistState, state: () => state, metadata: () => syncMetadata}; })();', ctx);
  return { ctx, original, databases, local, accesses };
}

test('Bloqueia execução fora da origem ou caminho de desenvolvimento antes de tocar armazenamento', () => {
  for (const url of ['https://domingodecafe.github.io/Agenda/', 'http://127.0.0.1:43188/', 'http://127.0.0.1:43187/ana-dev/']) {
    const ctx = context(url);
    for (const key of ['indexedDB', 'localStorage', 'navigator']) {
      Object.defineProperty(ctx, key, { get() { throw new Error('Acesso indevido: ' + key); } });
    }
    vm.runInContext(appSource, ctx);
    vm.runInContext(cloudSource, ctx);
    assert.equal(ctx.AnaCloud, undefined);
  }
});

test('Ana inicia vazia e preserva o IndexedDB original fictício sem abri-lo', async () => {
  const { ctx, original, databases, local, accesses } = persistenceContext();
  await ctx.persistence.loadState();
  assert.equal(ctx.persistence.state().clients.length, 0);
  await ctx.persistence.persistState();
  assert.deepEqual(databases.get('agenda-1-0-db'), original);
  assert.equal(JSON.parse(local.get('agenda-1-0-state')).clients[0].name, original.clients[0].name);
  assert.ok(accesses.every(([kind, key]) => !key.startsWith('agenda-1-0')));
  assert.ok(databases.has('ana-dev-agenda-db-v1'));
});

test('Fallback localStorage não lê nem migra a chave original', async () => {
  const { ctx, local, accesses } = persistenceContext({ failure: true });
  const before = local.get('agenda-1-0-state');
  await ctx.persistence.loadState();
  assert.equal(ctx.persistence.state().clients.length, 0);
  await ctx.persistence.persistState();
  assert.equal(local.get('agenda-1-0-state'), before);
  assert.ok(local.has('ana-dev-agenda-state-v1'));
  assert.ok(accesses.filter(([kind]) => kind.startsWith('local')).every(([, key]) => key.startsWith('ana-dev-agenda-')));
});

test('Fallback preserva apenas dados fictícios já existentes na chave Ana', async () => {
  const { ctx, local } = persistenceContext({ failure: true });
  local.set('ana-dev-agenda-state-v1', JSON.stringify({clients:[{name:'TESTE ANA'}],appointments:[],settings:{}}));
  await ctx.persistence.loadState();
  assert.equal(ctx.persistence.state().clients[0].name, 'TESTE ANA');
});

test('Marcador de fallback impede reabrir uma cópia IndexedDB desatualizada', async () => {
  const {ctx,local,databases}=persistenceContext();
  databases.set('ana-dev-agenda-db-v1',{clients:[{name:'TESTE ANTIGO'}],appointments:[],settings:{}});
  local.set('ana-dev-agenda-fallback-active-v1','active');
  local.set('ana-dev-agenda-state-v1',JSON.stringify({anaLocalVersion:1,state:{clients:[{name:'TESTE PENDENTE'}],appointments:[],settings:{}},sync:{revision:7,dirty:true}}));
  await ctx.persistence.loadState();
  assert.equal(ctx.persistence.state().clients[0].name,'TESTE PENDENTE');
  assert.equal(ctx.persistence.metadata().revision,7);
});

test('Dados e revisão são gravados juntos no mesmo envelope local', async () => {
  const {ctx,databases}=persistenceContext();
  const data={clients:[{name:'TESTE ATÔMICO'}],appointments:[],settings:{}};
  const meta={revision:9,dirty:true,owner:'test-owner'};
  const saving=ctx.persistence.persistState(data,meta);
  data.clients[0].name='TESTE POSTERIOR';meta.revision=10;
  await saving;
  const saved=databases.get('ana-dev-agenda-db-v1');
  assert.equal(saved.anaLocalVersion,1);assert.equal(saved.sync.revision,9);
  assert.equal(saved.state.clients[0].name,'TESTE ATÔMICO');
});

test('Ações do formulário ficam fora da seção ocultada ao criar bloqueios', async () => {
  const html=await read('index.html');const form=html.slice(html.indexOf('<form id="appointment-form"'),html.indexOf('</form>',html.indexOf('<form id="appointment-form"')));
  const stack=[];
  for(const match of form.matchAll(/<\/?div\b[^>]*>/g)){
    if(match[0].startsWith('</'))stack.pop();
    else{
      if(match[0].includes('modal-actions'))assert.ok(!stack.includes('appointment-extra'),'Botões Salvar/Excluir não podem ficar dentro da seção oculta');
      stack.push(match[0].match(/id="([^"]+)"/)?.[1]||'div');
    }
  }
  assert.equal(stack.length,0,'Divs do formulário balanceadas');
});

function workerContext(scope = devURL) {
  const events = new Map();
  const opened = [];
  const matched = [];
  const cached = [];
  const foreignCache = { sentinel: 'CACHE ORIGINAL FICTÍCIO' };
  const ctx = context(new URL('sw-ana-dev.js', devURL).href, {
    registration: { scope },
    addEventListener(type, listener) { events.set(type, listener); },
    importScripts() {},
    caches: {
      async open(name) {
        opened.push(name);
        assert.equal(name, 'ana-dev-pwa-v5');
        return {
          async addAll(files) { cached.push(...files); },
          async match(request) { matched.push(request); return 'RESPOSTA ANA'; }
        };
      },
      match() { throw new Error('Proibido consultar cache global'); },
      delete() { throw new Error('Proibido excluir caches'); },
      keys() { throw new Error('Proibido enumerar caches alheios'); }
    },
    clients: { async claim() {} },
    fetch() { throw new Error('Requisição inesperada'); }
  });
  return { ctx, events, opened, matched, cached, foreignCache };
}

test('Worker recusa escopo raiz', () => {
  const {ctx} = workerContext('http://127.0.0.1:43188/');
  assert.throws(() => vm.runInContext(workerSource, ctx), /bloqueado/);
});

test('Worker pré-carrega todos os scripts e usa somente cache Ana', async () => {
  const { ctx, events, opened, cached, foreignCache } = workerContext();
  vm.runInContext(workerSource, ctx);
  let pending;
  events.get('install')({waitUntil(promise) { pending = promise; }});
  await pending;
  assert.deepEqual(opened, ['ana-dev-pwa-v5']);
  for (const filename of ['ana-environment.js', 'cloud-sync.js', 'app.js']) {
    assert.ok(cached.includes('./' + filename + '?v=ana-dev-5'));
  }
  assert.equal(foreignCache.sentinel, 'CACHE ORIGINAL FICTÍCIO');
});

test('Worker não intercepta outra origem, caminho externo nem chamada de API', () => {
  const { ctx, events } = workerContext();
  vm.runInContext(workerSource, ctx);
  for (const url of ['https://domingodecafe.github.io/Agenda/', 'http://127.0.0.1:43188/index.html', 'http://127.0.0.1:43188/ana-dev/verificar-isolamento.html', 'https://dpdxzbbzymkygutwefww.supabase.co/rest/v1/agenda_snapshots']) {
    events.get('fetch')({request:{method:'GET',url,mode:'navigate'},respondWith(){assert.fail('Interceptação fora de escopo');}});
  }
});

test('Worker consulta só o próprio cache para navegação e arquivos de desenvolvimento', async () => {
  const { ctx, events, opened } = workerContext();
  vm.runInContext(workerSource, ctx);
  for (const [url,mode] of [[devURL,'navigate'],[devURL+'cloud-sync.js?v=ana-dev-5','cors']]) {
    let response;
    events.get('fetch')({request:{method:'GET',url,mode},respondWith(promise){response=promise;}});
    assert.equal(await response, 'RESPOSTA ANA');
  }
  assert.ok(opened.every(name => name === 'ana-dev-pwa-v5'));
});

test('Manifesto tem identidade e início próprios; cliente Auth tem chave separada', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.id, '/ana-dev/ana-secretaria-desenvolvimento');
  assert.equal(manifest.scope, '/ana-dev/');
  assert.ok(manifest.start_url.startsWith(manifest.scope));
  assert.equal(manifest.short_name, 'Ana DEV');
  assert.match(cloudSource, /storageKey:environment.authStorageKey/);
  assert.match(cloudSource, /const CONFIG_KEY = environment.cloudConfigKey/);
  assert.match(cloudSource, /c.url !== environment.cloudUrl/);
  assert.doesNotMatch(appSource + cloudSource + workerSource, /deleteDatabase|caches\.delete|\.unregister\(|localStorage\.clear/);
});
