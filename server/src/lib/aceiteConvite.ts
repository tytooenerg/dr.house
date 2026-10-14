import crypto from 'node:crypto';
import { z } from 'zod';
import { getAceite, aceiteSlaStatus } from '../db/aceites.js';
import { getDuplicata, setSacadoCnpj } from '../db/duplicatas.js';
import { createAceiteConvite, getAceiteConviteByHash, marcarConviteUsado } from '../db/aceiteConvites.js';
import { recordAuditEvent } from '../db/audit.js';
import { effectiveOwnerId } from '../db/users.js';
import { applyAceiteDecision } from './aceiteCore.js';
import { reavaliarLastro } from './lastroCompletar.js';
import { cnpjChecksumValido } from './cnpjLookup.js';
import { sendEmail, mailerEnabled } from './mailer.js';
import { sendWhatsapp, twilioEnabled } from './smsNotifier.js';
import { fmtBRL, fmtRelative, toIsoUtc } from './format.js';
import { logger } from './logger.js';
import type { UserRow } from '../db/types.js';

// Aceite do sacado por link — sem precisar de conta.
//
// O sacado só era avisado de uma duplicata se já tivesse conta de sacado cujo nome de empresa
// batesse letra a letra com o que o cedente digitou (db/users.ts's
// getSacadoAccountByCompanyName). Sem conta — o caso comum de um cliente novo — ninguém o
// avisava, e a empresa esperava os 15 dias do aceite tácito para poder antecipar.
//
// O convite leva um link de uso único por e-mail e/ou WhatsApp. Envio "real-when-configured":
// SMTP_* manda o e-mail de verdade (sem ele, lib/mailer.ts só registra no log) e TWILIO_*
// manda o WhatsApp. Independentemente disso, o cedente sempre recebe o link e um atalho
// wa.me com a mensagem pronta, para mandar do próprio WhatsApp — funciona sem credencial
// nenhuma e não finge um envio que não aconteceu.
//
// O que isto É: uma confirmação eletrônica identificada — quem respondeu digita o CNPJ da
// empresa sacada, nome e cargo, e a resposta fica registrada com IP, navegador e horário.
// O que NÃO é: assinatura com certificado ICP-Brasil. Para o aceite da duplicata escritural
// isso basta (o próprio aceite tácito por silêncio é válido), mas a distinção fica escrita
// aqui para ninguém vendê-la como outra coisa.

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const conviteSchema = z
  .object({
    email: z.string().trim().email('E-mail inválido.').optional().or(z.literal('')),
    telefone: z.string().trim().optional().or(z.literal('')),
  })
  .refine((v) => !!(v.email || v.telefone), { message: 'Informe o e-mail ou o WhatsApp do sacado.' });

export const respostaSchema = z.object({
  decisao: z.enum(['aceita', 'contestada']),
  cnpj: z.string().trim().min(1),
  nome: z.string().trim().min(3).max(120),
  cargo: z.string().trim().min(2).max(80),
  motivo: z.string().trim().max(1000).optional().default(''),
});

type Falha = { status: 400 | 403 | 404 | 409 | 410; body: { error: string; message: string } };

function soDigitos(s: string) {
  return s.replace(/\D/g, '');
}

function prazoFmt(prazoLimite: string | null): string {
  return prazoLimite ? new Date(toIsoUtc(prazoLimite)).toLocaleDateString('pt-BR') : '—';
}

export interface ConviteCriado {
  link: string;
  mensagem: string;
  whatsappUrl: string;
  email: { destino: string; status: 'enviado' | 'simulado' } | null;
  whatsapp: { destino: string; status: 'enviado' | 'nao_configurado' } | null;
}

export async function criarConvite(user: UserRow, aceiteId: number, input: { email?: string; telefone?: string }): Promise<{ status: 200; body: ConviteCriado } | Falha> {
  const aceite = getAceite(aceiteId);
  const d = aceite ? getDuplicata(aceite.duplicata_id) : undefined;
  if (!aceite || !d || d.sandbox || d.cedente_id !== effectiveOwnerId(user)) {
    return { status: 404, body: { error: 'not_found', message: 'Aceite não encontrado.' } };
  }
  if (aceite.status !== 'aguardando') {
    return { status: 409, body: { error: 'ja_respondido', message: 'O sacado já respondeu a esta duplicata.' } };
  }
  if (aceiteSlaStatus(aceite).vencido) {
    return { status: 409, body: { error: 'prazo_encerrado', message: 'O prazo de aceite já terminou — vale o aceite tácito.' } };
  }
  const email = input.email?.trim() || null;
  const telefone = input.telefone?.trim() ? soDigitos(input.telefone) : null;
  if (telefone !== null && telefone.length < 10) {
    return { status: 400, body: { error: 'validation_error', message: 'WhatsApp inválido — informe DDD e número.' } };
  }

  const token = crypto.randomBytes(24).toString('base64url');
  createAceiteConvite({ aceiteId, tokenHash: hash(token), email, telefone, criadoPor: user.id });

  const link = `${APP_URL}/aceite/${token}`;
  const mensagem =
    `${d.cedente_nome} emitiu uma duplicata de ${fmtBRL(d.valor)} para ${d.sacado_nome}, com vencimento em ${d.vencimento}. ` +
    `Confira e confirme (ou conteste) até ${prazoFmt(aceite.prazo_limite)}, sem precisar criar conta: ${link}`;
  const foneWa = telefone ? (telefone.startsWith('55') ? telefone : `55${telefone}`) : '';
  const whatsappUrl = `https://wa.me/${foneWa}?text=${encodeURIComponent(mensagem)}`;

  let emailStatus: ConviteCriado['email'] = null;
  if (email) {
    await sendEmail(email, `Confirme a duplicata de ${d.cedente_nome}`, `Olá,\n\n${mensagem}\n\nLastro — infraestrutura de duplicatas escriturais.`);
    emailStatus = { destino: email, status: mailerEnabled ? 'enviado' : 'simulado' };
  }
  let whatsappStatus: ConviteCriado['whatsapp'] = null;
  if (telefone) {
    if (twilioEnabled) {
      await sendWhatsapp(telefone, mensagem);
      whatsappStatus = { destino: telefone, status: 'enviado' };
    } else {
      logger.info({ aceiteId }, '[aceite-convite] TWILIO_* não configurado — WhatsApp não enviado; o cedente recebe o atalho wa.me');
      whatsappStatus = { destino: telefone, status: 'nao_configurado' };
    }
  }
  recordAuditEvent(user.id, user.company_name, 'aceite.convite_enviado', {
    duplicataId: d.id,
    aceiteId,
    email: emailStatus?.status ?? null,
    whatsapp: whatsappStatus?.status ?? null,
  });
  return { status: 200, body: { link, mensagem, whatsappUrl, email: emailStatus, whatsapp: whatsappStatus } };
}

function conviteValido(token: string) {
  const convite = getAceiteConviteByHash(hash(token));
  const aceite = convite ? getAceite(convite.aceite_id) : undefined;
  const d = aceite ? getDuplicata(aceite.duplicata_id) : undefined;
  if (!convite || !aceite || !d || d.sandbox) {
    return { falha: { status: 404, body: { error: 'convite_invalido', message: 'Link inválido. Peça um novo ao emitente da duplicata.' } } as Falha };
  }
  if (convite.usado_em || aceite.status !== 'aguardando') {
    return { falha: { status: 410, body: { error: 'ja_respondido', message: 'Esta duplicata já foi respondida — obrigado.' } } as Falha };
  }
  if (aceiteSlaStatus(aceite).vencido) {
    return { falha: { status: 410, body: { error: 'prazo_encerrado', message: 'O prazo para responder terminou.' } } as Falha };
  }
  return { convite, aceite, d };
}

/** O que a página pública mostra ao sacado antes de ele decidir. */
export function verConvite(token: string) {
  const v = conviteValido(token);
  if ('falha' in v) return v.falha!;
  const { aceite, d } = v;
  return {
    status: 200 as const,
    body: {
      duplicataId: d.id,
      emitente: d.cedente_nome,
      sacado: d.sacado_nome,
      valorFmt: fmtBRL(d.valor),
      emissao: d.emissao,
      vencimento: d.vencimento,
      nfeChave: d.nfe_chave,
      registro: d.registro,
      prazoAte: prazoFmt(aceite.prazo_limite),
      // Sem CNPJ do sacado na duplicata (comum no CSV/ERP), quem responde informa o da
      // própria empresa — e ele passa a valer para a duplicata.
      cnpjConhecido: cnpjChecksumValido(soDigitos(d.sacado_cnpj)),
      enviadoHa: fmtRelative(v.convite.created_at),
    },
  };
}

export function responderConvite(token: string, resposta: z.infer<typeof respostaSchema>, meta: { ip: string | null; userAgent: string | null }) {
  const v = conviteValido(token);
  if ('falha' in v) return v.falha!;
  const { convite, aceite, d } = v;

  const cnpj = soDigitos(resposta.cnpj);
  if (!cnpjChecksumValido(cnpj)) {
    return { status: 400 as const, body: { error: 'validation_error', message: 'CNPJ inválido — confira os 14 dígitos.' } };
  }
  const cnpjDaDuplicata = soDigitos(d.sacado_cnpj);
  if (cnpjChecksumValido(cnpjDaDuplicata) && cnpj !== cnpjDaDuplicata) {
    return { status: 403 as const, body: { error: 'cnpj_nao_confere', message: 'Este CNPJ não é o da empresa sacada desta duplicata.' } };
  }
  if (resposta.decisao === 'contestada' && resposta.motivo.length < 5) {
    return { status: 400 as const, body: { error: 'validation_error', message: 'Conte o motivo da contestação para o emitente poder resolver.' } };
  }
  if (!marcarConviteUsado(convite.id, { decisao: resposta.decisao, nome: resposta.nome, cargo: resposta.cargo, ip: meta.ip, userAgent: meta.userAgent })) {
    return { status: 410 as const, body: { error: 'ja_respondido', message: 'Esta duplicata já foi respondida — obrigado.' } };
  }

  applyAceiteDecision(aceite, d, resposta.decisao, resposta.decisao === 'contestada' ? resposta.motivo : undefined);
  recordAuditEvent(null, `${resposta.nome} (${resposta.cargo}) — ${d.sacado_nome}, via link`, `aceite.${resposta.decisao}`, {
    duplicataId: d.id,
    aceiteId: aceite.id,
    conviteId: convite.id,
    via: 'link',
    ip: meta.ip,
  });
  // O CNPJ que faltou na emissão, informado pelo próprio sacado, completa esse item do lastro.
  if (!cnpjChecksumValido(cnpjDaDuplicata)) {
    setSacadoCnpj(d.id, resposta.cnpj);
    reavaliarLastro(d.id);
  }
  return { status: 200 as const, body: { ok: true, decisao: resposta.decisao } };
}
