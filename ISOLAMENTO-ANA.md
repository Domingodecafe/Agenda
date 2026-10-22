# Proteção da Agenda original — 22/10/2026

**Atualização Aula 3.6:** esta proteção continua ativa. A sincronização opt-in
foi implementada posteriormente; consulte [AULA-3.6-SINCRONIZACAO.md](AULA-3.6-SINCRONIZACAO.md).
O cache atual é `ana-dev-pwa-v5` (o cache v1 abaixo registra a validação inicial).
Novos journals e marcador de fallback também têm prefixos `ana-dev-`.

## Resultado e limites da validação

Ana DEV foi isolada e validada localmente na branch `feat/ana-supabase`.
Não é necessário criar outro repositório para este ambiente local: a execução
está restrita a uma origem de testes e os identificadores são próprios.
Uma branch sozinha não separa o armazenamento do navegador. Por isso esta
proteção combina origem, caminho, identificadores e bloqueio de execução.

Nenhum commit, push, merge ou deploy foi realizado. A branch remota `main`
permaneceu em `d4051cc283bda20674e9e579bdfadc24f8feaf3c`, o mesmo SHA observado
antes da alteração. A branch remota de desenvolvimento também permaneceu em
`aae3cad7b6ff9d7509e0848328c3eeefe6575579`; as mudanças estão somente locais.
Nenhuma configuração de publicação, permissão do GitHub ou arquivo de workflow
foi alterado. A aplicação instalada no celular não foi aberta ou manipulada.
Esta é evidência do que foi preservado por este trabalho; não é uma auditoria
dos dados ou da instalação do celular.

## Abrir somente a Ana de testes

Execute `node preview.mjs` nesta pasta e abra:

**http://127.0.0.1:43188/ana-dev/**

O servidor escuta somente no loopback. A antiga prévia na porta 43187 foi
encerrada; seu armazenamento e Service Worker não foram removidos. Não se deve
reaproveitar o endereço da Agenda original nem publicar esta branch em produção.
O código de Ana recusa inicialização de dados e registro do worker em qualquer
outra origem ou fora de `/ana-dev/`. Um futuro endereço HTTPS de homologação
precisa de autorização, revisão da lista em `ana-environment.js` e nova validação.

## Identificadores exclusivos

| Recurso | Ana DEV |
| --- | --- |
| Origem permitida | `http://127.0.0.1:43188` |
| Caminho da aplicação | `/ana-dev/` |
| IndexedDB | `ana-dev-agenda-db-v1` |
| Object store | `ana-dev-agenda` |
| Chave do estado no banco | `ana-dev-main` |
| Fallback localStorage | `ana-dev-agenda-state-v1` |
| Configuração pública Supabase | `ana-dev-supabase-config-v1` |
| Sessão Auth Supabase | `ana-dev-supabase-auth-v1` |
| Cache | `ana-dev-pwa-v1` |
| Script do worker | `/ana-dev/sw-ana-dev.js` |
| Escopo explícito do worker | `http://127.0.0.1:43188/ana-dev/` |
| Nome da PWA | Ana — Agenda de Desenvolvimento |
| Nome curto | Ana DEV |
| Identificador de instalação | `/ana-dev/ana-secretaria-desenvolvimento` |
| Início da PWA | `/ana-dev/index.html` |
| Nome dos backups | `ana-dev-backup-…json` / `ana-dev-nuvem-revisao-…json` |

Os identificadores antigos `agenda-1-0-db` e `agenda-1-0-state` não aparecem no
código funcional de Ana. Foram preservados nos testes como nomes de sentinelas
fictícias, para provar que não são usados. Não há migração, importação automática,
limpeza de cache, exclusão de banco ou cancelamento de registro de workers.
O novo SDK Auth também recebe storageKey próprio, evitando herdar outra sessão.

O worker só abre seu próprio cache; não usa `caches.match` global e não enumera
nem exclui caches. Não intercepta caminhos externos ao seu escopo ou requisições
ao Supabase/CDN. Os três scripts da aplicação e demais arquivos da PWA são
pré-carregados com as mesmas versões referenciadas no HTML. O modo offline
completo não foi ensaiado nesta etapa.

## Validação realizada

1. `node --test tests/isolation.test.mjs`: **9 testes aprovados**, incluindo
   preservação de banco sentinela fictício, fallback sem leitura da chave antiga,
   bloqueio fora de origem/caminho, recusa de worker no escopo raiz, uso exclusivo
   do cache Ana e não interceptação de outro aplicativo/API.
2. `node --check` nos arquivos JavaScript alterados e `git diff --check`: aprovados.
3. HTTP: raiz redireciona para `/ana-dev/`; aplicação e worker retornam 200;
   worker recebe `Service-Worker-Allowed: /ana-dev/`. `/sw.js`, `/app.js`, Git e SQL
   retornam 404. Não há worker servido na raiz.
4. Navegador: PWA exibiu Ana DEV, agenda e lista de clientes vazias, painel de
   nuvem sem configuração nem sessão anterior. O teste fictício da porta 43187
   não foi migrado.
5. [Diagnóstico local](http://127.0.0.1:43188/ana-dev/verificar-isolamento.html):
   **6 verificações aprovadas**, confirmando no navegador o banco criado, a
   identidade do manifesto, as chaves, o worker ativo e 7 arquivos no cache Ana.
   Essa página só lê metadados e o cache Ana; não abre registros de pacientes.
6. Supabase: consulta agregada somente de leitura retornou 1 snapshot total e
   1 snapshot identificado pelos IDs do cadastro e sessão fictícios já testados.
   Nenhum dado remoto foi alterado nesta etapa. Não há importação automática.

## Arquivos desta proteção

- `ana-environment.js`: origem/caminho permitidos e identificadores exclusivos.
- `app.js`: usa somente armazenamento Ana, escopo explícito e nome de backup Ana.
- `cloud-sync.js`: configuração e sessão Auth exclusivas, URL limitada ao projeto
  Secretaria Ana, aviso de uso apenas fictício.
- `sw-ana-dev.js`: substitui `sw.js` nesta branch, com cache/escopo próprios.
- `index.html`, `manifest.webmanifest`, `icon.svg`: identidade Ana DEV separada;
  scripts carregados depois da verificação do ambiente; ícone com selo DEV.
- `preview.mjs`: nova porta e somente caminhos sob `/ana-dev/`.
- `verificar-isolamento.html` e `verificar-isolamento.js`: diagnóstico local.
- `tests/isolation.test.mjs`: verificações automatizadas sem dados reais.
- `ISOLAMENTO-ANA.md`, `ANA-SUPABASE.md`, `PREPARACAO-ANA.md` e `LEIA-ME.md`:
  documentação do novo ambiente e indicação do caráter histórico dos testes
  anteriores.

O schema SQL e as regras de negócio da Agenda não foram alterados.

## Sincronização — etapa seguinte

A proteção local está validada. A sincronização automática ainda não foi
implementada: o conteúdo da Aula 3.6 não foi fornecido nesta conversa, e é
necessário recebê-lo para definir seu comportamento, conflitos e recuperação.
O snapshot fictício remoto anterior continua preservado e a origem nova começa
vazia; sincronizar esses estados sem uma regra explícita poderia apagar um
deles. Não ativar envio automático de estado vazio ou sobrescrita implícita.

## Referências técnicas

- [Identidade de instalação da PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
- [Escopo e origem dos Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [storageKey no SDK Supabase usado pela aplicação](https://github.com/supabase/supabase-js/blob/v2.49.1/src/lib/types.ts)
