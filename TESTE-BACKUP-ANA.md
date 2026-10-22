# Teste de backup e envio fictício — 22/10/2026

## Resultado

Envio inicial manual validado pelo painel da Agenda e por consulta de comparação
no banco. Projeto: Secretaria Ana (`dpdxzbbzymkygutwefww`). Branch local:
`feat/ana-supabase`. A PWA e o schema não foram modificados para este teste.

O usuário autorizou expressamente criar um paciente fictício, uma sessão,
exportar o backup e verificar o envio ao Supabase. Antes do envio, a consulta
autenticada confirmou que a conta ainda não tinha snapshot remoto. Nenhum
snapshot existente foi substituído e nenhum registro real foi utilizado.

## Dados criados pelo aplicativo

- Nome: `TESTE Ana 001 — FICTÍCIO`.
- Telefone vazio; valor padrão zero; observação identificada como DADO FICTÍCIO.
- Uma sessão única em **22/10/2026, 09:00–10:00**, horário de São Paulo.
- Tipo Sessão; modalidade Presencial; valor zero; sem recorrência.
- O aplicativo atribuiu status Agendado e financeiro A receber, com valor zero;
  não foi registrado pagamento.
- Cadastro e sessão persistiram após recarregar a página local.

## Backup e comparação

Backup exportado pelo botão Exportar backup local:

`C:\Users\Rickn\Downloads\agenda-backup-2026-10-22T13-16-16-118Z.json`

O JSON foi aberto e validado antes do envio: exatamente um cadastro fictício,
uma sessão vinculada a esse cadastro, telefone vazio, duração de 60 minutos e
valor zero. Os únicos campos de topo são clients, appointments e settings.
O backup não contém senha nem chave do Supabase.

O envio foi feito por Enviar cópia local e sua confirmação normal, usando o
login administrativo já autorizado. A interface retornou:

> Cópia enviada! Revisão 1. A edição continua LOCAL, sem sincronização automática.

Consulta SQL somente de leitura, limitada pelo ID do cadastro fictício e pela
contagem de um cliente/uma sessão, confirmou:

| Verificação | Resultado |
| --- | --- |
| Revisão remota | 1 |
| Atualização UTC | 2026-10-22 13:17:03.222652+00 |
| Cadastros no snapshot | 1 |
| Sessões no snapshot | 1 |
| Igualdade JSONB entre payload remoto e backup exportado | true |

A comparação JSONB verifica o conteúdo completo, sem depender da ordem das
chaves ou da formatação do arquivo. Não foram lidos snapshots de outros
pacientes ou usuários. A gravação aconteceu pelo aplicativo, não por SQL.
A sessão administrativa foi encerrada após o teste; credenciais não foram
registradas nos arquivos do projeto.

## Estado após o teste

O cadastro e a sessão fictícios continuam na origem local
`http://127.0.0.1:43187` e no snapshot remoto da conta utilizada. Não foram
excluídos automaticamente. O envio inicial da interface recusará nova cópia
enquanto houver esse snapshot; não excluir nem sobrescrever para contornar
essa proteção sem planejar a próxima etapa.

Validados: cadastro fictício, sessão única, persistência após recarregar,
exportação local, login, consulta de metadados, envio inicial e igualdade do
conteúdo gravado. Ainda não validados: download/restauração, isolamento entre
dois usuários, conflitos concorrentes, sincronização contínua, recorrências,
offline e integrações WhatsApp/n8n/IA.

Nenhum commit, push ou deploy foi feito nesta etapa.
