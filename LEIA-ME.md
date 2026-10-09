# Agenda

PWA responsiva para organizar atendimentos. Os dados são salvos somente no navegador do dispositivo, usando IndexedDB e localStorage como alternativa.

## Como usar

- Para uma consulta rápida no computador, abra `index.html`.
- Para instalar no celular e usar offline, publique esta pasta em um endereço HTTPS, abra o endereço no navegador do celular e escolha **Adicionar à tela inicial** ou **Instalar aplicativo**.
- Faça backup antes de limpar os dados do navegador, trocar de aparelho ou remover o aplicativo. Esta versão não sincroniza dados entre dispositivos.

## Recursos incluídos

- Agenda em Dia, Semana e Mês.
- Semana completa no celular, com os sete dias visíveis ao mesmo tempo.
- Gestos laterais para navegar por dias, semanas e meses, atravessando automaticamente meses e anos.
- Mês compacto com os sete dias visíveis sem rolagem horizontal.
- Atendimentos, bloqueios, edição, exclusão e remarcação.
- Duração padrão de uma hora, com horário final automático e edição manual.
- Seletores de horário próprios e legíveis no celular, em intervalos de 15 minutos.
- Recorrência semanal, quinzenal e mensal por 12 meses.
- Recorrência editável em atendimentos existentes, com recálculo das próximas sessões.
- Edição com escolha entre somente a ocorrência selecionada ou esta e todas as futuras.
- Exclusão separada para uma ocorrência ou para esta e todas as futuras da sequência.
- Novos horários escolhidos pela grade começam na hora cheia do bloco; ajustes manuais continuam em intervalos de 15 minutos.
- Cadastro simples de clientes e valor padrão.
- Campo de observações no cadastro de clientes.
- Cores por cliente e por atendimento: verde, amarelo, vermelho, roxo e azul.
- Todo novo atendimento começa em verde, com possibilidade de troca manual.
- Status clínico e financeiro separados.
- Resumo financeiro mensal.
- Clientes pendentes e parciais aparecem antes dos clientes pagos no Resumo.
- A lista mensal mostra dez clientes por vez, com carregamento incremental.
- O tipo Outro funciona como compromisso particular sem custo e não entra nos cálculos financeiros.
- Resumo mensal agrupado por cliente, com histórico completo de sessões passadas e futuras.
- Recebimento em lote para marcar vários atendimentos pendentes como pagos em uma única operação.
- Alteração financeira em lote para A receber, Pago ou Não pago, inclusive em sessões já pagas.
- No celular, ações financeiras aparecem entre os atendimentos passados e futuros sem cobrir a navegação.
- Um toque na data seleciona a sessão; dois toques abrem o atendimento na visão Dia da Agenda.
- O Resumo apresenta Recebido, Pendente (A receber + Não pago) e Total previsto, pelo mês dos atendimentos.
- Cada cliente mostra sessões pagas, valor pendente e total mensal.
- Os cabeçalhos da semana abrem a visão Dia, preservando a posição vertical.
- A versão v28 aparece junto à marca; novas versões oferecem o botão Atualizar após baixar, sem descartar formulários abertos. A verificação ocorre ao abrir, retornar ao app ou recuperar a conexão.
- No Resumo, Pendente em vermelho indica ao menos uma sessão já encerrada sem pagamento. Se só houver sessões futuras ou em andamento em aberto, aparece A receber em cinza. Todas pagas aparecem como Pago em verde. A classificação é atualizada a cada minuto enquanto a lista estiver aberta.
- O botão de olho no Resumo e no histórico oculta todos os valores dessas telas, inclusive o total selecionado. A preferência fica salva no aparelho; edição e confirmação de pagamento continuam mostrando os valores.
- Pagamentos registram data, forma (PIX, Dinheiro ou Outro) e descrição opcional.
- Pagamentos em lote são preenchidos sessão por sessão e gravados juntos após confirmação.
- Correções e reversões financeiras preservam um histórico auditável dentro da edição da sessão.
- Se uma versão antiga não exibir o aviso de atualização, feche todas as janelas da Agenda e reabra conectada à internet. Não limpe os dados do navegador.
- Interface simplificada sem status clínico e sem fluxo separado de remarcação.
- Funcionamento offline após a primeira abertura em um endereço HTTPS.
- Transições suaves entre telas, abas, calendários e modais, respeitando a preferência de redução de movimento do aparelho.
- Voltar do histórico financeiro retorna ao cliente selecionado na lista, inclusive após reordenação por pagamentos.
- Tema Grafite & Menta: fundo uniforme, navegação com ícones, controles legíveis e Resumo compacto com Recebido em destaque.
