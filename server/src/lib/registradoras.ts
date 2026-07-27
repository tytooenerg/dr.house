// The Banco Central authorized four registradoras for the duplicata escritural
// (Resolução BCB nº 339/2023): B3, CERC, Núclea and Grafeno (SPC). Today most
// integrations hardcode a single one; this is the abstraction layer a cedente/API
// partner shouldn't have to think about — Lastro picks the best route per operation.
export const REGISTRADORAS = [
  { key: 'cerc', name: 'CERC', custoPct: 0.015, tempoMedioSeg: 40, confiabilidadePct: 99.5 },
  { key: 'b3', name: 'B3', custoPct: 0.02, tempoMedioSeg: 25, confiabilidadePct: 99.8 },
  { key: 'nucleo', name: 'Núclea', custoPct: 0.012, tempoMedioSeg: 55, confiabilidadePct: 99.2 },
  { key: 'grafeno', name: 'Grafeno (SPC)', custoPct: 0.01, tempoMedioSeg: 60, confiabilidadePct: 98.7 },
] as const;

export type RegistradoraKey = (typeof REGISTRADORAS)[number]['key'];

export function getRegistradora(key: string | null) {
  return REGISTRADORAS.find((r) => r.key === key) ?? null;
}

// Smart routing: minimize registration cost, but for larger operations (where a
// failed/slow registration is costlier to redo) only route to registradoras with a
// track record of 99%+ reliability — this is why small tickets land on the cheapest
// option (Grafeno) while larger ones land on a pricier but more reliable one (Núclea).
export function chooseRegistradora(valor: number) {
  const eligible = valor > 200_000 ? REGISTRADORAS.filter((r) => r.confiabilidadePct >= 99) : REGISTRADORAS;
  return eligible.reduce((best, r) => (r.custoPct < best.custoPct ? r : best));
}
