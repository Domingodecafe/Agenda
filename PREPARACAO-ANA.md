# Preparação da Agenda / Ana — 22/10/2026

**Ambiente atual:** esta preparação é histórica. A prévia atual isolada está em
http://127.0.0.1:43188/ana-dev/, com banco e cache próprios e sem migração.
Consulte [ISOLAMENTO-ANA.md](ISOLAMENTO-ANA.md). O servidor anterior foi encerrado;
seus dados e caches foram preservados.

**Atualização posterior:** o usuário autorizou o teste de envio exclusivamente
fictício. Ele foi concluído e criou a revisão remota 1. Veja
[TESTE-BACKUP-ANA.md](TESTE-BACKUP-ANA.md) para o estado atual e as evidências.
As restrições e resultados abaixo registram a preparação anterior a esse teste.

## Estado encontrado

A pasta do workspace estava vazia. Foi clonada a branch `feat/ana-supabase` de
`https://github.com/Domingodecafe/Agenda.git`, commit
`aae3cad7b6ff9d7509e0848328c3eeefe6575579`. O remoto `origin` aponta para esse
repositório. A branch `main` não foi alterada. Não houve commit, push ou publicação.
Não há instruções AGENTS.md no repositório clonado.

Arquivos analisados: `app.js`, `index.html`, `cloud-sync.js`,
`ANA-SUPABASE.md`, `supabase/ana-schema.sql`, `sw.js` e manifesto PWA.

## Prévia local

1. Abra um terminal nesta pasta e execute `node preview.mjs` (Node já disponível).
2. Abra **http://127.0.0.1:43187** em um perfil de navegador exclusivo para testes,
   inicialmente vazio. Não abra a agenda de produção e não importe backups reais.
3. Use sempre esse mesmo endereço: host e porta definem o armazenamento local.
4. Para encerrar o servidor, pressione Ctrl+C no terminal.

O servidor só escuta neste computador e só entrega os sete arquivos públicos da
PWA. Git, SQL, documentos, backups e configurações não são servidos. Não é um
deploy. O endereço de loopback permite testar recursos de contexto seguro em
navegadores compatíveis; as chamadas ao Supabase e ao CDN usam HTTPS.
Não use `file://` nem exponha a porta para a rede. O servidor aceita GET/HEAD;
isso não bloqueia operações do navegador diretamente no Supabase.

## Primeiro teste: conexão sem transferência de agenda

1. Abra **Nuvem / Ana**.
2. Informe a URL `https://dpdxzbbzymkygutwefww.supabase.co`.
3. No painel do projeto Secretaria Ana, em API Keys, copie a chave pública ativa
   que começa com `sb_publishable_`. Clique **Salvar configuração**. Não use
   `service_role`, `sb_secret_` ou senha de banco. Não coloque credenciais no Git.
4. Digite seu e-mail administrativo e sua senha **diretamente no painel local**;
   não envie a senha pelo chat. Clique **Entrar**. O resultado esperado é
   `Conectado: seu e-mail`. Login administrativo validado em 22/10/2026; não registrar senha neste arquivo.
5. Clique **Ver estado remoto**. O resultado esperado é uma revisão/data ou
   `Ainda não existe agenda remota para sua conta`. Essa operação lê somente
   metadados do snapshot do usuário autenticado.
6. Nesta etapa, **não clique Enviar cópia local nem Baixar cópia da nuvem**.
   A conta administrativa pode conter uma cópia real. Não a use para testes de
   escrita, mesmo que os dados locais sejam fictícios.
7. Clique **Sair** ao terminar. A sessão autenticada persiste neste perfil até
   o logout; a configuração pública também fica no navegador.

## Teste local com dados fictícios

Depois de sair, feche o painel. Na aba Clientes, cadastre `TESTE Ana 001`, sem
telefone, com valor zero e observação `DADO FICTÍCIO`. Crie uma sessão única de
60 minutos, sem cobrança, usando esse cadastro. Recarregue a aba e confirme que
cadastro e sessão continuam presentes. Teste também as visões Dia/Semana/Mês.
Use **Exportar backup local** e confira no JSON somente os registros fictícios.
O arquivo exportado não é criptografado. Essas ações ficam locais; não enviam
o cadastro ao Supabase automaticamente.

Um teste futuro de upload/download e RLS entre usuários precisa de conta ou
projeto de homologação dedicado e autorização para gravação. Não criar usuários,
reenviar SQL ou sobrescrever snapshots para concluir este primeiro teste.

## Implementado e pendente

| Área | Estado observado |
| --- | --- |
| Agenda, cadastros, recorrências, bloqueios e financeiro | Código existente preservado; esta etapa não é regressão completa dessas funções |
| Persistência | IndexedDB, fallback em localStorage |
| Backup local | Exportação JSON implementada; não criptografada |
| Supabase no navegador | SDK 2.49.1 fixado por URL, importado sob demanda |
| Login e logout | Login por e-mail/senha validado em navegador; logout testado ao concluir |
| Envio inicial | Snapshot integral, confirmação e recusa se já houver registro; não executado |
| Download | Exporta arquivo; não substitui dados locais; não executado |
| Sincronização contínua / importação | Ausentes |
| WhatsApp, IA, n8n, aprovação de contatos e lembretes | Planejamento; ausentes nesta branch |
| Disponibilidade e reservas concorrentes no servidor | Ausentes |
| Acesso mínimo da Ana e auditoria administrativa no servidor | Pendentes; snapshot inclui finanças e observações |

## Banco: consultas somente à estrutura

O projeto `Secretaria Ana` retornou `ACTIVE_HEALTHY`. Confirmados:
`agenda_snapshots` com RLS ativado; SELECT/INSERT/UPDATE por `auth.uid()` igual
a `owner_id`, com USING/WITH CHECK no UPDATE; função `write_agenda_snapshot`
como SECURITY INVOKER, search_path vazio e comparação de revisão.
Não foram lidos payloads, usuários ou registros da agenda; não houve gravação.
Em teste posterior nesta mesma etapa, o login administrativo por e-mail/senha funcionou e a consulta autenticada retornou: Ainda não existe agenda remota para sua conta. Nenhum payload foi consultado.

Pontos para revisão antes de sincronização ou uso da Ana:

- `CHECK` e IF baseados em `jsonb_typeof` não rejeitam com segurança todos os
  campos ausentes/NULL, por causa da lógica de NULL do SQL. Isso é análise do
  código/definição SQL, sem tentativa de inserir dados no projeto.
- O SQL concede INSERT/UPDATE direto a `authenticated`; RLS restringe o dono,
  mas esse caminho pode contornar a revisão da função. A revisão não é uma
  garantia universal de concorrência da tabela.
- O arquivo SQL cria políticas sem proteção contra reaplicação. Não reaplicar
  indiscriminadamente no banco já configurado.
- `sw.js` usa cache v30 e pré-carrega `app.js?v=30`, enquanto o HTML solicita
  `app.js?v=31` e `cloud-sync.js?v=31`; este último não é pré-carregado. O modo
  offline desta branch precisa de correção e teste próprios. Não foi alterado.
- O advisor de segurança retornou proteção contra senhas vazadas desativada.
  Revisar antes de uso real: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Verificações realizadas

- `node --check app.js`, `cloud-sync.js`, `sw.js` e `preview.mjs`: aprovados.
- Arquivos públicos e manifesto servidos com HTTP 200 e tipos adequados.
- `/.git/config` e `/supabase/ana-schema.sql`: HTTP 404; POST local: HTTP 405.
- Navegador: agenda carregou; painel abriu; URL/chave pública foram salvas na
  origem local de teste; consulta sem login exibiu exigência de autenticação.
- Teste adicional: login administrativo válido e consulta autenticada de metadados aprovados, sem snapshot remoto para a conta testada. Sessão encerrada após o teste. Senha não salva nos arquivos do projeto.
- Não testados: gravação e download autenticados, exportação
  de backup, fluxo completo de cadastros/recorrências, offline e isolamento RLS
  por dois usuários. A existência de código não confirma funcionamento completo.

Alterações locais desta preparação: servidor `preview.mjs`, este roteiro e
correções em `ANA-SUPABASE.md` (projeto existente, SDK e validação parcial).
Nenhum arquivo funcional da PWA ou schema foi alterado.
