import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PALETTE } from '../../lib/palette';

interface Advertisement {
  logoUrl: string;
  titulo: string;
  texto: string;
  linkUrl: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  ativo: boolean;
  rejectReason: string | null;
  impressoes: number;
  cliques: number;
}
interface AdvertisementData {
  ad: Advertisement | null;
  precoMensalFmt: string;
}

const STATUS_BADGE: Record<Advertisement['status'], { label: string; bg: string; color: string }> = {
  pendente: { label: 'Em análise', bg: PALETTE.amberBg, color: PALETTE.amber },
  aprovado: { label: 'Aprovado', bg: PALETTE.greenBg, color: PALETTE.green },
  rejeitado: { label: 'Rejeitado', bg: PALETTE.redBg, color: PALETTE.red },
};

export function PublicidadePage() {
  const [data, setData] = useState<AdvertisementData | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [togglingAtivo, setTogglingAtivo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    return api
      .get<AdvertisementData>('/advertisements/me')
      .then((d) => {
        setData(d);
        if (d.ad) {
          setLogoUrl(d.ad.logoUrl);
          setTitulo(d.ad.titulo);
          setTexto(d.ad.texto);
          setLinkUrl(d.ad.linkUrl);
        }
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar seu anúncio.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const d = await api.post<AdvertisementData>('/advertisements/me', { logoUrl, titulo, texto, linkUrl });
      setData(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o anúncio.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAtivo = async () => {
    if (!data.ad) return;
    setTogglingAtivo(true);
    try {
      const d = await api.post<AdvertisementData>('/advertisements/me/toggle', { ativo: !data.ad.ativo });
      setData(d);
    } finally {
      setTogglingAtivo(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Publicidade"
        subtitle="Configure seu anúncio no carrossel de publicidade da página inicial da Lastro"
      />

      <Card className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="font-bold text-[15px]">Mensalidade</div>
          <div className="font-mono-num font-bold text-blue">{data.precoMensalFmt}/mês</div>
        </div>
        <div className="text-textSecondary text-[12.5px]">
          Cobrada do saldo da sua conta (Conta &amp; Liquidação) enquanto o anúncio estiver aprovado e ativo. Deposite via Pix, TED ou boleto antes de ativar.
        </div>
      </Card>

      {data.ad && (
        <Card className="mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div className="font-bold text-[15px]">Status</div>
            <Badge {...STATUS_BADGE[data.ad.status]} />
          </div>
          {data.ad.status === 'rejeitado' && data.ad.rejectReason && (
            <div className="text-[12.5px] text-red mt-2">Motivo: {data.ad.rejectReason}</div>
          )}
          {data.ad.status === 'aprovado' && (
            <div className="flex items-center justify-between mt-3">
              <div className="text-[12.5px] text-textSecondary">
                {data.ad.ativo ? 'Rodando no carrossel — pausar interrompe a cobrança do próximo período.' : 'Pausado — não aparece no carrossel nem é cobrado.'}
              </div>
              <Toggle on={data.ad.ativo} onClick={() => { if (!togglingAtivo) toggleAtivo(); }} />
            </div>
          )}
          {data.ad.status === 'pendente' && (
            <div className="text-[12.5px] text-textSecondary mt-2">Um admin vai revisar o conteúdo antes dele ir ao ar — normalmente em até 1 dia útil.</div>
          )}
        </Card>
      )}

      {data.ad && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-1">Performance</div>
          <div className="text-textSecondary text-[12.5px] mb-3">
            Quantas vezes seu anúncio apareceu no carrossel da página inicial e quantos cliques o link recebeu.
          </div>
          <div className="flex gap-8">
            <div>
              <div className="font-mono-num text-[22px] font-extrabold">{data.ad.impressoes.toLocaleString('pt-BR')}</div>
              <div className="text-textTertiary text-[11.5px] font-bold uppercase tracking-wide mt-0.5">Impressões</div>
            </div>
            <div>
              <div className="font-mono-num text-[22px] font-extrabold">{data.ad.cliques.toLocaleString('pt-BR')}</div>
              <div className="text-textTertiary text-[11.5px] font-bold uppercase tracking-wide mt-0.5">Cliques</div>
            </div>
            <div>
              <div className="font-mono-num text-[22px] font-extrabold">
                {data.ad.impressoes > 0 ? `${((data.ad.cliques / data.ad.impressoes) * 100).toFixed(1)}%` : '—'}
              </div>
              <div className="text-textTertiary text-[11.5px] font-bold uppercase tracking-wide mt-0.5">CTR</div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="font-bold text-[15px] mb-1">{data.ad ? 'Editar anúncio' : 'Criar anúncio'}</div>
        <div className="text-textSecondary text-[12.5px] mb-4">
          {data.ad ? 'Qualquer alteração volta o anúncio para análise antes de rodar de novo.' : 'Logo, título curto, texto e link — é isso que aparece no carrossel.'}
        </div>
        <div className="flex flex-col gap-3.5 mb-5">
          <Field label="URL do logo">
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://suaempresa.com.br/logo.png" />
          </Field>
          <Field label="Título">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Sua empresa aqui" maxLength={60} />
          </Field>
          <Field label="Texto curto">
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Uma frase sobre o que sua empresa oferece" maxLength={160} />
          </Field>
          <Field label="Link de destino">
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://suaempresa.com.br" />
          </Field>
        </div>
        {error && <div className="mb-3 text-red text-[12.5px] font-semibold">{error}</div>}
        <Button onClick={save} disabled={saving || !logoUrl.trim() || !titulo.trim() || !texto.trim() || !linkUrl.trim()}>
          {saving ? 'Salvando…' : data.ad ? 'Salvar alterações' : 'Enviar para análise'}
        </Button>
      </Card>
    </div>
  );
}
