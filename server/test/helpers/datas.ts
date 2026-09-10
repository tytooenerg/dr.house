/**
 * Datas de vencimento para testes, relativas a HOJE.
 *
 * `server/src/db/seed.ts` já aprendeu esta lição e a escreveu com todas as letras no
 * `daysFromNow()`: *"a fixed future date eventually becomes a fixed past one"*. Os testes não
 * seguiram — e em 10/09/2026 a conta chegou: três testes de sinistro passaram a falhar porque
 * emitiam com `vencimento: '2026-09-10'` sob o comentário "ainda no futuro no momento da
 * contratação do seguro". A data não mudou; o mundo é que andou até ela.
 *
 * O caso é traiçoeiro porque não é flake nem regressão: a suíte fica verde por meses e um dia
 * amanhece vermelha sem ninguém ter tocado em nada. Um deploy legítimo trava por causa do
 * calendário.
 */

/** Vencimento garantidamente no futuro, no formato YYYY-MM-DD que `/emitir/submit` espera. */
export function vencimentoFuturo(dias = 90): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Vencimento no passado, para o teste que precisa de uma duplicata vencida.
 *
 * Este pode ser literal: uma data de 2020 é passado hoje e continuará sendo passado para
 * sempre. Só o futuro caduca.
 */
export const VENCIMENTO_VENCIDO = '2020-01-10';
