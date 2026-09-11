import { pixEnabled } from './paymentRail.js';
import { boletoEnabled } from './boletoRail.js';
import { tedEnabled } from './tedRail.js';
import { stablecoinEnabled } from './stablecoinRail.js';
import { bureauEnabled } from './creditBureau.js';
import { esignatureEnabled } from './esignature.js';
import { pldProviderEnabled } from './sanctionsFeed.js';
import { biometricKycEnabled } from './biometricKyc.js';
import { backupEnabled } from './backup.js';
import { claudeEnabled } from './claude.js';
import { twilioEnabled } from './smsNotifier.js';
import { sentryEnabled } from './sentry.js';
import { REGISTRADORAS, registradoraConfigured } from './registradoras.js';
import { cnpjLookupEnabled } from './cnpjLookup.js';
import { nfeStatusEnabled } from './nfeStatus.js';

// Este arquivo responde a uma pergunta que nenhum outro respondia: **este servidor está apto a
// mover dinheiro de verdade?**
//
// A disciplina "real-when-configured" faz cada integração externa cair num modo simulado
// ROTULADO quando a credencial falta, e o servidor diz isso na subida — quinze linhas
// `[pix] … não configurado`, `[boleto] …`, `[registradoras] …`. O problema nunca foi a
// honestidade dessas linhas; foi que ninguém as junta. `/api/health` devolve `{ok:true}`, as
// flags moram espalhadas em dezenove módulos, e a única forma de saber em que modo a instância
// está era ler o log de boot.
//
// Pior: nada impedia o acidente que isso deveria impedir. Com NODE_ENV=production e PIX_PSP_*
// em branco, um cliente real abre Conta & Liquidação, pede um depósito, e recebe uma cobrança
// simulada. O saldo aparece na tela. Ele acha que depositou. Ver `exigirTrilhoReal` em
// routes/account.ts, que é o trinco construído em cima daqui.
//
// As flags são IMPORTADAS dos próprios módulos, nunca redeclaradas: se este arquivo tivesse a
// sua própria noção de "configurado", ela divergiria da do trilho que de fato move o dinheiro —
// e um preflight que mente é pior que preflight nenhum.

export interface ItemDePreflight {
  chave: string;
  nome: string;
  real: boolean;
  /** As variáveis de ambiente que fazem este item deixar de ser simulado. */
  envs: string[];
  /** O que acontece hoje, sem elas. */
  semEle: string;
}

/**
 * Os trilhos que movem dinheiro DE VERDADE — a fronteira entre o ledger interno e o mundo.
 *
 * É a lista que o trinco consulta. A chave é a mesma usada em routes/account.ts pra mapear
 * rota → trilho, então acrescentar um trilho aqui e esquecer da rota (ou o contrário) é
 * pegado pelo teste de cobertura em test/preflight.test.ts.
 */
export function trilhosDeDinheiro(): ItemDePreflight[] {
  return [
    { chave: 'pix', nome: 'Pix', real: pixEnabled, envs: ['PIX_PSP_BASE_URL', 'PIX_PSP_CLIENT_ID', 'PIX_PSP_CLIENT_SECRET', 'PIX_CHAVE_RECEBEDOR'], semEle: 'depósitos e saques Pix são simulados localmente' },
    { chave: 'boleto', nome: 'Boleto', real: boletoEnabled, envs: ['BOLETO_PSP_BASE_URL', 'BOLETO_PSP_CLIENT_ID', 'BOLETO_PSP_CLIENT_SECRET', 'BOLETO_CEDENTE_CNPJ'], semEle: 'boletos são simulados localmente' },
    { chave: 'ted', nome: 'TED', real: tedEnabled, envs: ['TED_PSP_BASE_URL', 'TED_PSP_CLIENT_ID', 'TED_PSP_CLIENT_SECRET'], semEle: 'dados bancários de depósito e transferências são simulados' },
    { chave: 'stablecoin', nome: 'Stablecoin', real: stablecoinEnabled, envs: ['STABLECOIN_PSP_BASE_URL', 'STABLECOIN_PSP_CLIENT_ID', 'STABLECOIN_PSP_CLIENT_SECRET'], semEle: 'endereços de depósito são simulados' },
  ];
}

/**
 * O resto: importa muito, mas não move dinheiro sozinho, então informa em vez de travar.
 *
 * A registradora é o item mais pesado desta lista e merece a ressalva que `lib/registradoras.ts`
 * já carrega: mesmo configurada, o adaptador é um REST genérico honesto e NÃO uma cópia
 * verificada do contrato privado de nenhuma das quatro autorizadas pela Res. BCB nº 339/2023.
 */
export function integracoes(): ItemDePreflight[] {
  const registradorasReais = REGISTRADORAS.filter((r) => registradoraConfigured(r.key));
  return [
    {
      chave: 'registradora',
      nome: `Registradora (${registradorasReais.length}/${REGISTRADORAS.length} configuradas)`,
      real: registradorasReais.length > 0,
      envs: ['REGISTRADORA_CERC_API_URL/KEY', 'REGISTRADORA_B3_API_URL/KEY', 'REGISTRADORA_NUCLEA_API_URL/KEY', 'REGISTRADORA_GRAFENO_API_URL/KEY'],
      semEle: 'o número de registro é gerado localmente — a duplicata não é registrada em lugar nenhum',
    },
    { chave: 'bureau', nome: 'Bureau de crédito', real: bureauEnabled, envs: ['BUREAU_API_URL', 'BUREAU_API_KEY'], semEle: 'o score fica só interno + sinal de rede, sem dado de bureau' },
    { chave: 'pld', nome: 'PLD/sanções (provedor pago)', real: pldProviderEnabled, envs: ['PLD_PROVIDER_API_URL', 'PLD_PROVIDER_API_KEY'], semEle: 'a triagem cai na lista OFAC gratuita ou na tabela fictícia de demonstração' },
    { chave: 'esignature', nome: 'Assinatura eletrônica', real: esignatureEnabled, envs: ['ESIGNATURE_API_URL', 'ESIGNATURE_API_KEY'], semEle: 'o envio para assinatura é simulado' },
    { chave: 'kyc', nome: 'KYC biométrico', real: biometricKycEnabled, envs: ['BIOMETRIC_KYC_API_URL', 'BIOMETRIC_KYC_API_KEY'], semEle: 'verificação biométrica desativada' },
    { chave: 'backup', nome: 'Backup off-site', real: backupEnabled, envs: ['BACKUP_OFFSITE_CMD'], semEle: 'o snapshot fica só no disco do próprio servidor' },
    { chave: 'sentry', nome: 'Monitoramento de erros', real: sentryEnabled, envs: ['SENTRY_DSN'], semEle: 'erros de produção só aparecem no log local' },
    { chave: 'claude', nome: 'IA (Claude)', real: claudeEnabled, envs: ['ANTHROPIC_API_KEY'], semEle: 'os recursos assistidos por IA usam fallback estático, rotulado' },
    { chave: 'twilio', nome: 'WhatsApp/SMS', real: twilioEnabled, envs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], semEle: 'mensagens são apenas logadas' },
    {
      chave: 'cnpjLookup',
      nome: 'Situação real do CNPJ (Receita Federal)',
      real: cnpjLookupEnabled,
      envs: ['CNPJ_LOOKUP_LIVE'],
      semEle: 'só o dígito verificador do CNPJ é checado — sem consulta à situação cadastral real',
    },
    {
      chave: 'nfeStatus',
      nome: 'Situação real da NF-e (SEFAZ)',
      real: nfeStatusEnabled,
      envs: ['NFE_STATUS_API_URL', 'NFE_STATUS_API_KEY'],
      semEle: 'só o dígito verificador da chave de acesso é checado — sem consulta à situação real na SEFAZ',
    },
  ];
}

/**
 * Esta instância é uma demonstração, e não uma operação real?
 *
 * Reusa a convenção que db/seed.ts já documentou em vez de inventar outra: `SEED_DEMO_DATA=true`
 * é a válvula de escape para "um ambiente que NÃO é produção mas roda com NODE_ENV=production" —
 * exatamente o `webServer` do e2e, e um ambiente de vendas/demo público. Numa instância assim,
 * dinheiro simulado é o comportamento desejado e o trinco não deve atrapalhar.
 *
 * Lido em tempo de chamada, não no import: é o que permite testar os dois lados.
 */
export function modoDemonstracao(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true';
}

export interface Prontidao {
  modo: 'producao' | 'demonstracao';
  /** Em produção de verdade, com pelo menos um trilho de dinheiro real. */
  podeMoverDinheiro: boolean;
  dinheiro: ItemDePreflight[];
  integracoes: ItemDePreflight[];
  /** Trilhos de dinheiro bloqueados agora — vazio em modo demonstração. */
  bloqueados: string[];
}

export function prontidao(): Prontidao {
  const demo = modoDemonstracao();
  const dinheiro = trilhosDeDinheiro();
  return {
    modo: demo ? 'demonstracao' : 'producao',
    podeMoverDinheiro: !demo && dinheiro.some((t) => t.real),
    dinheiro,
    integracoes: integracoes(),
    bloqueados: demo ? [] : dinheiro.filter((t) => !t.real).map((t) => t.chave),
  };
}

/** Uma linha só pro boot, depois das quinze que cada módulo já escreve por conta própria. */
export function resumoDeBoot(): string {
  const p = prontidao();
  const reais = p.dinheiro.filter((t) => t.real).map((t) => t.chave);
  const simuladas = p.integracoes.filter((i) => !i.real).length;
  if (p.modo === 'demonstracao') {
    return `[preflight] modo demonstração — dinheiro simulado por desenho, ${simuladas} integração(ões) simulada(s). Nenhum trilho bloqueado.`;
  }
  if (reais.length === 0) {
    return `[preflight] ATENÇÃO: produção sem nenhum trilho de dinheiro real — depósito e saque estão BLOQUEADOS (${p.bloqueados.join(', ')}). Configure um PSP antes de abrir para clientes.`;
  }
  return `[preflight] produção · dinheiro real: ${reais.join(', ')}${p.bloqueados.length ? ` · bloqueados: ${p.bloqueados.join(', ')}` : ''} · ${simuladas} integração(ões) simulada(s).`;
}
