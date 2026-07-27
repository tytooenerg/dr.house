import { useState } from 'react';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface SimResult {
  valorFmt: string;
  taxaEstimadaFmt: string;
  plataformaFeeFmt: string;
  sacadoRecognized: boolean;
  sacadoRecognizedText: string;
}

// Standalone, chrome-less page meant to be embedded via <iframe> on a partner's own
// site (see the snippet generated in Desenvolvedores) — no auth, no nav, just the
// calculator, so it renders cleanly inside a small embedded frame.
export function EmbedSimuladorPage() {
  const [sacado, setSacado] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const simular = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/public/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sacado, valor, vencimento }),
      });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      setError('Não foi possível simular agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-white text-navy p-5" style={{ fontFamily: 'inherit' }}>
      <div className="font-extrabold text-[16px] mb-1">Simule sua antecipação</div>
      <div className="text-textSecondary text-[12.5px] mb-4">Taxa estimada com o mesmo modelo de risco da Lastro — sem compromisso.</div>
      <form onSubmit={simular} className="flex flex-col gap-3">
        <Field label="Empresa sacada (opcional)">
          <Input value={sacado} onChange={(e) => setSacado(e.target.value)} placeholder="Ex: Grupo Atlas Varejo" />
        </Field>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Valor da duplicata">
            <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="84.500,00" />
          </Field>
          <Field label="Vencimento">
            <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={loading || !valor} className="self-start">
          {loading ? 'Calculando…' : 'Simular'}
        </Button>
      </form>
      {error && <div className="mt-3 text-red text-[12.5px] font-semibold">{error}</div>}
      {result && (
        <div className="mt-4 p-4 rounded-[10px] bg-[#F7F8FA] border border-border">
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="text-textTertiary text-[11px] font-bold">TAXA ESTIMADA</div>
              <div className="font-extrabold text-[18px] mt-0.5">{result.taxaEstimadaFmt}</div>
            </div>
            <div>
              <div className="text-textTertiary text-[11px] font-bold">TAXA DA PLATAFORMA</div>
              <div className="font-extrabold text-[18px] mt-0.5">{result.plataformaFeeFmt}</div>
            </div>
          </div>
          {result.sacadoRecognizedText && <div className="mt-3 text-[12px] text-textSecondary">{result.sacadoRecognizedText}</div>}
          <a href="/" target="_blank" rel="noreferrer" className="inline-block mt-3 text-[12.5px] font-bold text-blue">
            Antecipar com a Lastro →
          </a>
        </div>
      )}
    </div>
  );
}
