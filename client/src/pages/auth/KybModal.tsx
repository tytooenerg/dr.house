import { ModalOverlay } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { useSession } from '../../state/SessionContext';

export function KybModal() {
  const { session, updateKyb, kybNext, kybBack } = useSession();
  if (!session) return null;
  const { kybStep, kybForm, kybTipoOptions } = session;

  return (
    <ModalOverlay maxWidth={520}>
      <div className="text-[12.5px] font-bold text-blue uppercase tracking-wide mb-1.5">Credenciamento institucional</div>
      <div className="text-[21px] font-extrabold mb-5">Antes de participar do leilão</div>

      {kybStep === 0 && (
        <div className="flex flex-col gap-3.5 mb-2">
          <Field label="CNPJ da instituição">
            <Input placeholder="00.000.000/0001-00" value={kybForm.cnpj} onChange={(e) => updateKyb('cnpj', e.target.value)} />
          </Field>
          <div>
            <div className="text-[12.5px] font-bold text-textSecondary mb-1.5">Tipo de instituição</div>
            <div className="flex flex-col gap-2">
              {kybTipoOptions.map((t) => {
                const selected = kybForm.tipo === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateKyb('tipo', t)}
                    className="px-3.5 py-2.5 rounded-lg border border-inputBorder text-[13.5px] font-semibold cursor-pointer text-left"
                    style={{ background: selected ? '#1E5EFF' : '#fff', color: selected ? '#fff' : '#0B1F3A' }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {kybStep === 1 && (
        <div className="flex flex-col gap-3.5 mb-2">
          <Field label="Patrimônio líquido para alocação (R$)">
            <Input placeholder="5.000.000" value={kybForm.pl} onChange={(e) => updateKyb('pl', e.target.value)} />
          </Field>
          <div className="border-2 border-dashed border-[#C7D0DE] rounded-xl p-[22px] text-center">
            <div className="font-bold text-[13.5px]">Envie sua autorização regulatória</div>
            <div className="text-textSecondary text-[12.5px] mt-1">Ato de autorização BCB/CVM ou contrato social + procuração</div>
          </div>
        </div>
      )}

      {kybStep === 2 && (
        <div className="flex flex-col gap-3 mb-2">
          <div className="p-4 rounded-[10px] bg-navy text-white">
            <div className="text-[22px] font-extrabold">R$ 128,4M</div>
            <div className="text-[#9FB3D6] text-[12.5px] mt-1">já em oferta ativa no marketplace este mês — sua instituição pode começar a dar lances assim que aprovada</div>
          </div>
          <div className="p-4 rounded-[10px] bg-bg text-[13.5px] text-[#3D4658] leading-relaxed">
            Sua instituição será verificada junto ao Banco Central antes da liberação total para leilão — enquanto isso, você já pode explorar o marketplace em modo consulta.
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-[9px] h-[9px] rounded-full bg-green" />
            <span className="text-[13px] font-semibold">Documentos recebidos — análise em até 2 dias úteis</span>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-4">
        {kybStep > 0 ? (
          <button type="button" className="bg-transparent border-none text-textSecondary text-[13px] font-bold cursor-pointer" onClick={kybBack}>
            Voltar
          </button>
        ) : (
          <div />
        )}
        <Button onClick={kybNext}>{kybStep === 2 ? 'Concluir credenciamento' : 'Próximo'}</Button>
      </div>
    </ModalOverlay>
  );
}
