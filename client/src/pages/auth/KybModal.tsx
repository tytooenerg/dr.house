import { useRef, useState } from 'react';
import { ModalOverlay } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';
import { uploadFile } from '../../lib/api';
import { PALETTE } from '../../lib/palette';

export function KybModal() {
  const { user, submitKyb } = useSession();
  const [step, setStep] = useState(0);
  const [cnpj, setCnpj] = useState('');
  const [tipo, setTipo] = useState('Banco comercial');
  const [pl, setPl] = useState('');
  const [naoResidente, setNaoResidente] = useState(false);
  const [paisDomicilio, setPaisDomicilio] = useState('');
  const [taxIdEstrangeiro, setTaxIdEstrangeiro] = useState('');
  const [representanteLegal, setRepresentanteLegal] = useState('');
  const [docUploaded, setDocUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      await uploadFile('kyb_doc', file);
      setDocUploaded(true);
    } catch {
      setDocUploaded(false);
    } finally {
      setUploading(false);
    }
  };

  const next = async () => {
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setSubmitting(true);
    try {
      await submitKyb({ cnpj, tipo, pl, naoResidente, paisDomicilio, taxIdEstrangeiro, representanteLegal });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay maxWidth={520}>
      <div className="text-[12.5px] font-bold text-blue uppercase tracking-wide mb-1.5">Credenciamento institucional</div>
      <div className="text-[21px] font-extrabold mb-5">Antes de participar do leilão</div>

        {step === 0 && (
          <div className="flex flex-col gap-3.5 mb-2">
            <button
              type="button"
              onClick={() => setNaoResidente(!naoResidente)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-inputBorder text-[12.5px] font-semibold text-left cursor-pointer bg-transparent"
            >
              <span
                className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                style={{ border: `2px solid ${naoResidente ? PALETTE.blue : PALETTE.borderStrong}`, background: naoResidente ? PALETTE.blue : '#fff' }}
              >
                {naoResidente && <span className="text-white text-[11px] leading-none">✓</span>}
              </span>
              Somos um investidor não residente (instituição estrangeira)
            </button>

            {naoResidente ? (
              <>
                <Field label="País de domicílio">
                  <Input placeholder="Estados Unidos" value={paisDomicilio} onChange={(e) => setPaisDomicilio(e.target.value)} />
                </Field>
                <Field label="Identificação fiscal no país de origem (equivalente ao CNPJ)">
                  <Input placeholder="EIN, TIN, VAT…" value={taxIdEstrangeiro} onChange={(e) => setTaxIdEstrangeiro(e.target.value)} />
                </Field>
                <Field label="Representante no Brasil (instituição autorizada pelo BC)">
                  <Input placeholder="Nome do banco/instituição representante" value={representanteLegal} onChange={(e) => setRepresentanteLegal(e.target.value)} />
                </Field>
                <div className="text-[11.5px] text-textTertiary leading-relaxed">
                  Investidores não residentes acessam a plataforma via Res. Conjunta BCB/CVM 13/2024. Um representante autorizado pelo Banco Central é
                  necessário antes da operação — nossa equipe de compliance entrará em contato para concluir essa etapa.
                </div>
              </>
            ) : (
              <Field label="CNPJ da instituição">
                <Input placeholder="00.000.000/0001-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              </Field>
            )}
            <div>
              <div className="text-[12.5px] font-bold text-textSecondary mb-1.5">Tipo de instituição</div>
              <div className="flex flex-col gap-2">
                {user.kybTipoOptions.map((t) => {
                  const selected = tipo === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      className="px-3.5 py-2.5 rounded-lg border border-inputBorder text-[13.5px] font-semibold cursor-pointer text-left"
                      style={{ background: selected ? PALETTE.blue : '#fff', color: selected ? '#fff' : PALETTE.navy }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3.5 mb-2">
            <Field label="Patrimônio líquido para alocação (R$)">
              <Input placeholder="5.000.000" value={pl} onChange={(e) => setPl(e.target.value)} />
            </Field>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-borderStrong rounded-xl p-[22px] text-center cursor-pointer bg-transparent"
            >
              <div className="font-bold text-[13.5px]">{docUploaded ? 'Documento enviado ✓' : uploading ? 'Enviando…' : 'Envie sua autorização regulatória'}</div>
              <div className="text-textSecondary text-[12.5px] mt-1">Ato de autorização BCB/CVM ou contrato social + procuração</div>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3 mb-2">
            <div className="p-4 rounded-[10px] bg-navy text-white">
              <div className="text-[22px] font-extrabold">R$ 128,4M</div>
              <div className="text-onNavy text-[12.5px] mt-1">já em oferta ativa no marketplace este mês — sua instituição pode começar a dar lances assim que aprovada</div>
            </div>
            <div className="p-4 rounded-[10px] bg-bg text-[13.5px] text-slate leading-relaxed">
              Sua instituição será verificada junto ao Banco Central antes da liberação total para leilão — enquanto isso, você já pode explorar o marketplace em modo consulta.
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-[9px] h-[9px] rounded-full bg-green" />
              <span className="text-[13px] font-semibold">Documentos recebidos — análise em até 2 dias úteis</span>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-4">
          {step > 0 ? (
            <button type="button" className="bg-transparent border-none text-textSecondary text-[13px] font-bold cursor-pointer" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          ) : (
            <div />
          )}
          <Button onClick={next} disabled={submitting}>
            {step === 2 ? (submitting ? 'Enviando…' : 'Concluir credenciamento') : 'Próximo'}
          </Button>
        </div>
    </ModalOverlay>
  );
}
