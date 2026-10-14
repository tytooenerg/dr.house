import { listByCedente } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { effectiveOwnerId, getSettings } from '../db/users.js';
import type { UserRow } from '../db/types.js';

// "Seu primeiro dinheiro em 4 passos" — o guia da Visão Geral da empresa, com o progresso
// REAL de cada passo (não um carrossel que some e não leva a lugar nenhum, como o onboarding
// antigo). Some sozinho quando os quatro estão feitos.

export interface PassoView {
  key: 'documentos' | 'pix' | 'duplicata' | 'aceite';
  titulo: string;
  descricao: string;
  estado: 'feito' | 'em_andamento' | 'pendente';
  estadoLabel: string;
  link: string;
  acao: string;
}

export function primeirosPassos(user: UserRow): { passos: PassoView[]; concluidos: number; total: number } | null {
  if (user.role !== 'cedente') return null;
  const settings = getSettings(user);
  const duplicatas = listByCedente(effectiveOwnerId(user));
  const algumAceite = duplicatas.some((d) => getAceiteByDuplicata(d.id)?.status === 'aceita');

  const docs: Pick<PassoView, 'estado' | 'estadoLabel'> =
    user.kyb_status === 'approved'
      ? { estado: 'feito', estadoLabel: 'Aprovados' }
      : user.kyb_status === 'pending'
        ? { estado: 'em_andamento', estadoLabel: 'Em análise' }
        : user.kyb_status === 'rejected'
          ? { estado: 'pendente', estadoLabel: 'Recusados — reenviar' }
          : { estado: 'pendente', estadoLabel: 'Pendente' };

  const passos: PassoView[] = [
    {
      key: 'documentos',
      titulo: 'Documentos da empresa',
      descricao: 'Cartão CNPJ, contrato social e documento do representante. Análise em até 2 dias úteis.',
      ...docs,
      link: '/app/conta',
      acao: 'Enviar documentos',
    },
    {
      key: 'pix',
      titulo: 'Chave Pix para receber',
      descricao: 'É para onde vai o dinheiro quando um financiador arremata sua duplicata.',
      estado: settings.pixChave ? 'feito' : 'pendente',
      estadoLabel: settings.pixChave ? 'Cadastrada' : 'Pendente',
      link: '/app/conta',
      acao: 'Cadastrar chave Pix',
    },
    {
      key: 'duplicata',
      titulo: 'Emitir a primeira duplicata',
      descricao: 'Envie o XML ou PDF da nota fiscal — os dados são preenchidos para você.',
      estado: duplicatas.length > 0 ? 'feito' : 'pendente',
      estadoLabel: duplicatas.length > 0 ? 'Emitida' : 'Pendente',
      link: '/app/emitir',
      acao: 'Emitir duplicata',
    },
    {
      key: 'aceite',
      titulo: 'Aceite do seu cliente (sacado)',
      descricao: 'Mande o link de aceite por e-mail ou WhatsApp — ele confirma sem precisar criar conta.',
      estado: algumAceite ? 'feito' : duplicatas.length > 0 ? 'em_andamento' : 'pendente',
      estadoLabel: algumAceite ? 'Confirmado' : duplicatas.length > 0 ? 'Aguardando o sacado' : 'Pendente',
      link: '/app/aceite',
      acao: 'Enviar link de aceite',
    },
  ];
  return { passos, concluidos: passos.filter((p) => p.estado === 'feito').length, total: passos.length };
}
