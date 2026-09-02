import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';

interface Advertisement {
  logoUrl: string;
  titulo: string;
  texto: string;
  linkUrl: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  ativo: boolean;
  rejectReason: string | null;
}
interface AdvertisementData {
  ad: Advertisement | null;
  precoMensalFmt: string;
}

const STATUS_BADGE: Record<Advertisement['status'], { label: string; bg: string; color: string }> = {
  pendente: { label: 'Em análise', bg: '#FBF1E0', color: '#8A5A00' },
  aprovado: { label: 'Aprovado', bg: '#EAF3EE', color: '#0A5C36' },
  rejeitado: { label: 'Rejeitado', bg: '#FBEAE8', color: '#B3261E' },
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

  const load = () =>
    api.get<AdvertisementData>('/advertisements/me').then((d) => {
      setData(d);
      if (d.ad) {
        setLogoUrl(d.ad.logoUrl);
        setTitulo(d.ad.titulo);
        setTexto(d.ad.texto);
        setLinkUrl(d.ad.linkUrl);
      }
    });

  useEffect(() => {
    load();
  }, []);

  if (!data) return null;

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
