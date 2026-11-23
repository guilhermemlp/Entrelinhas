// Datas são tratadas como 'YYYY-MM-DD' (dia civil), nunca como instante.
// Usar toISOString() para obter "hoje" erra perto da meia-noite em fusos
// negativos (Brasil), por isso a data vem dos componentes locais.

export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Aritmética em UTC sobre o dia civil: evita saltos de horário de verão.
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function monthRange(year: number, month0: number): { from: string; to: string } {
  const first = `${year}-${String(month0 + 1).padStart(2, '0')}-01`;
  const last = addDays(first, new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate() - 1);
  return { from: first, to: last };
}
