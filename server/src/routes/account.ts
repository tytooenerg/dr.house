import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';
import { EXTRATO_RAW } from '../data/seed.js';
import { fmtBRL } from '../lib/format.js';
import { getRevenueStreams } from '../store/computed.js';

export const accountRouter = Router();

function extrato() {
  let saldo = 842600;
  return EXTRATO_RAW.map((r) => {
    const row = {
      data: r.data,
      descricao: r.descricao,
      valorFmt: (r.valor >= 0 ? '+' : '') + fmtBRL(r.valor),
      isPositive: r.valor >= 0,
      saldoFmt: fmtBRL(saldo),
    };
    saldo -= r.valor;
    return row;
  });
}

function payload() {
  return {
    kycChecklist: [
      { label: 'Dados cadastrais da empresa', status: 'Concluído', bg: '#EAF3EE', color: '#0A5C36', action: null },
      {
        label: 'Documentos societários (contrato social)',
        status: state.kycDocsUploaded ? 'Concluído' : state.kycDocsRejected ? 'Recusado — foto ilegível' : 'Pendente',
        bg: state.kycDocsUploaded ? '#EAF3EE' : state.kycDocsRejected ? '#F7E9E7' : '#F0F2F5',
        color: state.kycDocsUploaded ? '#0A5C36' : state.kycDocsRejected ? '#B03A2E' : '#5B6472',
        action: state.kycDocsUploaded ? null : { label: state.kycDocsRejected ? 'Reenviar documentos' : 'Enviar documentos', key: 'docs' },
      },
      { label: 'Verificação antifraude (KYC)', status: 'Em análise', bg: '#FBF1E0', color: '#B8790A', action: null },
      {
        label: 'Conta bancária para liquidação',
        status: state.kycBankConnected ? 'Concluído' : 'Pendente',
        bg: state.kycBankConnected ? '#EAF3EE' : '#F0F2F5',
        color: state.kycBankConnected ? '#0A5C36' : '#5B6472',
        action: state.kycBankConnected ? null : { label: 'Conectar conta', key: 'bank' },
      },
    ],
    bankAccountDisplay: state.kycBankConnected ? 'Banco Itaú Unibanco · Ag 1234 · CC 00045-6 ✓' : 'Nenhuma conta conectada — conclua o KYC acima',
    settlementSpeed: state.settlementSpeed,
    extrato: extrato(),
  };
}

accountRouter.get('/', (_req, res) => res.json(payload()));

accountRouter.post('/kyc/bank', (_req, res) => {
  actions.connectBank();
  res.json(payload());
});

accountRouter.post('/kyc/docs', (_req, res) => {
  actions.uploadDocs();
  res.json(payload());
});

accountRouter.post('/settlement-speed', (req, res) => {
  actions.setSettlementSpeed(req.body.speed);
  res.json(payload());
});

export const revenueRouter = Router();
revenueRouter.get('/', (_req, res) => res.json(getRevenueStreams()));
