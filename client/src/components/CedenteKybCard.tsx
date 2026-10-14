import { useRef, useState } from 'react';
import { ApiError, uploadFile } from '../lib/api';
import { Card } from './ui/Card';
import { Field, Input } from './ui/Input';
import { Button } from './ui/Button';
import { Notice } from './ui/Notice';
import { useSession } from '../state/SessionContext';

// Credenciamento documental da empresa (server/src/lib/cedenteKyb.ts). Morava escondido na
// tela de Emitir, enquanto a tela de Conta tinha um checklist de "documentos" de mentira que
// não recebia arquivo nenhum. Agora é este componente, nos dois lugares.
//
// Até aqui só o investidor passava por credenciamento documental (KybModal.tsx, tela
// cheia, bloqueante). O cedente — quem recebe o dinheiro antecipado — nunca precisou
// provar que a empresa existe de verdade. Em vez de repetir o modal bloqueante (que
// travaria o app inteiro pra uma conta que já usa a plataforma há meses), isto só aparece
// aqui, no ponto exato que passa a exigir o credenciamento: emitir uma duplicata nova.
// Contas cedente já existentes antes desta mudança foram aprovadas de uma vez (migração
// 0076) e nunca veem este card.
export function CedenteKybCard({ contexto = 'emitir', onEnviado }: { contexto?: 'emitir' | 'conta'; onEnviado?: () => void }) {
  const { user, submitCedenteKyb } = useSession();
  // Começa a partir do que o servidor já tem guardado (user.cedenteKybDocsStatus) — sem
  // isso, um cedente que já enviou 2 dos 3 documentos numa sessão anterior veria os três
  // como "não enviado" de novo ao recarregar a página, e reenviaria à toa um documento
  // que já existe.
  const [cnpjDocAnexado, setCnpjDocAnexado] = useState(!!user?.cedenteKybDocsStatus?.cnpj);
  const [contratoSocialAnexado, setContratoSocialAnexado] = useState(!!user?.cedenteKybDocsStatus?.contratoSocial);
  const [representanteAnexado, setRepresentanteAnexado] = useState(!!user?.cedenteKybDocsStatus?.representante);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  // O CNPJ informado no cadastro já vem preenchido — a empresa não digita duas vezes.
  const [cnpjTexto, setCnpjTexto] = useState(user?.kybForm?.cnpj ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const cnpjFileRef = useRef<HTMLInputElement>(null);
  const contratoFileRef = useRef<HTMLInputElement>(null);
  const representanteFileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  if (user.kybStatus === 'approved') {
    return (
      <Card className="p-6">
        <div className="font-bold text-[15px]">Documentos da empresa aprovados ✓</div>
      </Card>
    );
  }

  if (user.kybStatus === 'pending') {
    return (
      <Card className="p-6">
        <div className="font-bold text-[15px] mb-1">Credenciamento documental em análise</div>
        <div className="text-textSecondary text-[13px]">
          Enviamos seus documentos para análise — você poderá emitir duplicatas assim que forem aprovados (normalmente em até 2 dias úteis).
        </div>
      </Card>
    );
  }

  const handleFile = async (kind: string, mark: (v: boolean) => void, file: File) => {
    setUploadingKind(kind);
    setError('');
    try {
      await uploadFile(kind, file);
      mark(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao enviar o arquivo.');
    } finally {
      setUploadingKind(null);
    }
  };

  const enviar = async () => {
    setSubmitting(true);
    setError('');
    try {
      await submitCedenteKyb({ cnpj: cnpjTexto });
      onEnviado?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar para análise.');
    } finally {
      setSubmitting(false);
    }
  };

  const tudoAnexado = cnpjDocAnexado && contratoSocialAnexado && representanteAnexado;

  return (
    <Card className="p-6">
      <div className="font-bold text-[15px] mb-1">{contexto === 'emitir' ? 'Envie os documentos da empresa para começar a emitir' : 'Documentos da empresa'}</div>
      <div className="text-textSecondary text-[13px] mb-4">
        Precisamos confirmar que a empresa existe de verdade antes da primeira duplicata — envie os três documentos abaixo. A análise leva até 2 dias úteis
        e você é avisado quando terminar.
      </div>
      {user.kybStatus === 'rejected' && user.kybRejectReason && (
        <Notice variant="danger" className="text-sm mb-3">
          Credenciamento anterior rejeitado: {user.kybRejectReason}. Envie os documentos novamente.
        </Notice>
      )}
      <Field label="CNPJ da empresa">
        <Input placeholder="00.000.000/0001-00" value={cnpjTexto} onChange={(e) => setCnpjTexto(e.target.value)} />
      </Field>
      <div className="grid gap-3 mt-3 mb-4 grid-cols-1 sm:grid-cols-3">
        <input
          ref={cnpjFileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile('kyb_cedente_cnpj', setCnpjDocAnexado, f);
          }}
        />
        <button type="button" onClick={() => cnpjFileRef.current?.click()} className="border-2 border-dashed border-borderStrong rounded-xl p-4 text-center cursor-pointer bg-transparent">
          <div className="font-bold text-[12.5px]">{cnpjDocAnexado ? 'Cartão CNPJ ✓' : uploadingKind === 'kyb_cedente_cnpj' ? 'Enviando…' : 'Cartão CNPJ'}</div>
        </button>

        <input
          ref={contratoFileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile('kyb_cedente_contrato_social', setContratoSocialAnexado, f);
          }}
        />
        <button type="button" onClick={() => contratoFileRef.current?.click()} className="border-2 border-dashed border-borderStrong rounded-xl p-4 text-center cursor-pointer bg-transparent">
          <div className="font-bold text-[12.5px]">
            {contratoSocialAnexado ? 'Contrato social ✓' : uploadingKind === 'kyb_cedente_contrato_social' ? 'Enviando…' : 'Contrato social'}
          </div>
        </button>

        <input
          ref={representanteFileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile('kyb_cedente_representante', setRepresentanteAnexado, f);
          }}
        />
        <button
          type="button"
          onClick={() => representanteFileRef.current?.click()}
          className="border-2 border-dashed border-borderStrong rounded-xl p-4 text-center cursor-pointer bg-transparent"
        >
          <div className="font-bold text-[12.5px]">
            {representanteAnexado ? 'Doc. do representante ✓' : uploadingKind === 'kyb_cedente_representante' ? 'Enviando…' : 'Doc. do representante legal'}
          </div>
        </button>
      </div>
      <Button disabled={!tudoAnexado || !cnpjTexto.trim() || submitting} onClick={enviar}>
        {submitting ? 'Enviando…' : 'Enviar para análise'}
      </Button>
      {error && <Notice variant="danger" className="text-sm mt-3">{error}</Notice>}
    </Card>
  );
}
