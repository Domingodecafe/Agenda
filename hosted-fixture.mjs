// Cenário sintético. Nenhum registro é copiado de um perfil do navegador.
const names = [
  'Lia Monteverde', 'Caio Solamar', 'Nina Venturim', 'Davi Valeclaro', 'Iara Cedrini',
  'Theo Lunamar', 'Mila Brisalta', 'Ravi Floreno', 'Sara Fonteluz', 'Noah Belcampo',
  'Eva Maravento', 'Luan Pedraflora', 'Clara Nascente', 'Bento Arvoredo', 'Luna Floraviva',
  'Otto Ribeiro Azul', 'Maya Solverde', 'Enzo Valedouro', 'Íris Brumavale', 'Leo Candeal',
];
const schedule = {
  1: [[14, 15, 16, 17], 3], 2: [[8, 9, 10, 11, 14, 15, 16, 17], 5],
  3: [[8, 9, 10, 11, 14, 15, 16, 17], 4], 4: [[8, 9, 10, 11, 14, 15, 16, 17], 5],
  5: [[14, 15, 16, 17], 3],
};
const pad = value => String(value).padStart(2, '0');
const hour = value => pad(value) + ':00';

export function createFixture() {
  const clients = names.map((name, index) => ({
    id: 'teste-cliente-' + index, name: name + ' (Teste)', phone: '', notes: '', color: 'green', defaultValue: 200,
  }));
  const appointments = [];
  for (let day = 1; day <= 30; day++) {
    const date = '2026-11-' + pad(day);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (!schedule[weekday]) continue;
    const [slots, count] = schedule[weekday];
    const offset = (Math.floor((day - 1) / 7) + weekday) % slots.length;
    const starts = [...slots.slice(offset), ...slots.slice(0, offset)].slice(0, count).sort((a, b) => a - b);
    for (const start of starts) {
      const index = appointments.length;
      const client = clients[(index + Math.floor(index / 20) * 3) % clients.length];
      const paid = day <= 6 && index % 5 !== 4;
      appointments.push({
        id: 'teste-sessao-' + index, kind: 'appointment', type: 'Sessão', date, start: hour(start), end: hour(start + 1),
        clientId: client.id, clientName: client.name, modality: index % 3 ? 'Presencial' : 'Online',
        value: 200, color: 'green', recurrence: 'none', seriesId: null, status: 'Agendado',
        financialStatus: paid ? 'Pago' : 'A receber', payment: paid ? { date, method: 'PIX', methodDetail: '' } : null,
      });
    }
  }
  return { clients, appointments, settings: { view: 'month' } };
}
