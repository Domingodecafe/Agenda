# Integração Ana + Supabase (preparação)

## Isolamento do projeto
A conta Supabase acessível contém somente **base LADO A** (inativo). Não use esse projeto para pacientes do consultório. Crie um projeto Supabase dedicado à **Agenda Henrique / Ana**, na organização que você escolher. Nenhuma tabela real foi criada pelo trabalho nesta branch.

## A implementação
- `supabase/ana-schema.sql`: tabela `agenda_snapshots` com RLS, titularidade por `auth.uid()` e função `write_agenda_snapshot` com revisão otimista. O documento JSON preserva os arrays `clients`, `appointments` e `settings` e todos os campos atuais (recorrências, pagamentos, bloqueios etc.).
- `cloud-sync.js`: cliente Supabase JS fixado na versão 2.118.0 (carregado só quando necessário), autenticação por e-mail/senha e transferência manual (envio inicial e download de cópia), sem sincronização contínua.
- `app.js` e `index.html`: exportação de backup; configuração de Supabase; exportação local; envio inicial sem sobrescrever estado remoto e download remoto para arquivo. A agenda CONTINUA local; não existe modo nuvem de edição.

## Configurar (somente após backup e em projeto dedicado)
1. Crie projeto Supabase privado/dedicado, habilite Data API para `public` e configure Supabase Auth. Desabilite auto-cadastro público (signup). Cadastre manualmente um usuário administrador verificado, com senha forte e MFA quando possível.
2. No SQL Editor do projeto dedicado, aplique `supabase/ana-schema.sql`. Verifique tabelas e políticas RLS, e execute os advisors de segurança.
3. Hospede o aplicativo sob HTTPS, abra `Nuvem`, informe **Project URL** e uma **publishable key** (não `service_role` / `secret`!), faça login com sua conta.
4. Clique `Exportar backup` e guarde o JSON **localmente e criptografado**; os dados incluem prontuário administrativo e financeiro.
5. Envie explicitamente uma cópia inicial pelo botão `Enviar cópia local`. O sistema recusa sobrepor um registro remoto já existente. Em outros dispositivos, use `Baixar cópia da nuvem` apenas para exportar um arquivo; ainda não há importação nem sincronização automática.
6. Verifique clientes/atendimentos e alterações em ambiente de teste antes de habilitar dados reais.

## Limitações e etapas necessárias antes de pacientes reais
- Não foi feito deploy e **a Ana ainda não tem permissão de editar via WhatsApp**. O n8n precisará de um backend próprio (Edge Function autenticada ou servidor com credencial secreta protegida), sem entregar chaves privilegiadas à IA ou ao navegador.
- O formato por snapshot simplifica compatibilidade com o PWA atual, mas para múltiplos editores simultâneos e reservas robustas será necessário migrar para tabelas normalizadas de pacientes/atendimentos, verificar colisões **transacionalmente** no servidor e limitar os campos lidos pela Ana (principalmente observações e finanças).
- A aplicação existente não valida colisões de horários de forma transacional. **Não autorize agendamento automático real pela Ana** antes dessa implementação.
- Dados no IndexedDB/localStorage continuam existindo neste dispositivo como cópia local. O backup exportado não é criptografado; proteja-o fora do aplicativo.
- No estágio atual, a edição do app permanece local, independente da nuvem. Nunca considere o backup remoto automaticamente atualizado após editar o aplicativo. Não force uma substituição de dados remotos.
- Validação de contatos desconhecidos: pendente de implementação no backend da Ana, conforme Regra 10.
- Como testar: use apenas dados fictícios, teste cadastro, editar, exclusão, recorrências, recarregar aba, atualizar em outro aparelho e perda de rede. Confirme revisões e RLS com dois usuários de teste.

## Referências
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/reference/javascript/installing
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys

## Estado real da branch
- Entrega parcial, com possibilidade de login, backup local, envio inicial e download da cópia remota; **não é ainda uma agenda multi-dispositivo**.
- O arquivo JS da interface carrega o SDK Supabase via CDN apenas quando o usuário tenta se conectar; se estiver offline, as operações remotas não funcionam.
- Revisões impedem substituição do primeiro backup remoto, mas o próximo passo exige sincronização bidirecional e migração de formato antes de operação com a Ana.
- Ainda não houve teste do painel em navegador nem criação de base remota; código deve ser testado com dados fictícios.
