import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNav, PublicFooter } from './PublicChrome';

interface PublicStats {
  volumeEmitidoFmt: string;
  totalDuplicatas: number;
  totalCedentes: number;
  totalInvestidores: number;
  taxaInadimplenciaPct: number;
}

interface Advertisement {
  id: number;
  logoUrl: string;
  titulo: string;
  texto: string;
  linkUrl: string;
}

const AD_ROTATE_MS = 6000;

// Carrossel de publicidade (feature "Carrossel de publicidade") — conteúdo pago de
// empresas anunciantes, rotativo, rotulado como publicidade de propósito (nunca
// apresentado como parceria/endosso da Lastro). Renderiza null quando não há nenhum
// anúncio aprovado+ativo — nunca mostra uma seção vazia pra quem visita.
function AdCarousel({ ads }: { ads: Advertisement[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (ads.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % ads.length), AD_ROTATE_MS);
    return () => clearInterval(id);
  }, [ads.length]);

  if (ads.length === 0) return null;
  const ad = ads[index % ads.length];

  return (
    <div className="px-14 py-10 max-w-[1360px] mx-auto">
      <div className="text-[11px] font-bold text-textTertiary uppercase tracking-wide mb-3 text-center">Publicidade</div>
      <a
        href={ad.linkUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="flex items-center gap-5 border border-border rounded-card p-6 hover:bg-[#F7F8FA] transition-colors"
      >
        <img src={ad.logoUrl} alt={ad.titulo} className="w-16 h-16 rounded-lg object-contain bg-[#F7F8FA] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[16px]">{ad.titulo}</div>
          <div className="text-textSecondary text-[13.5px] mt-1">{ad.texto}</div>
        </div>
        <div className="text-blue font-bold text-[13px] whitespace-nowrap">Saiba mais →</div>
      </a>
      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-4">
          {ads.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Ver anúncio ${i + 1}`}
              className="rounded-full border-none cursor-pointer p-0"
              style={{ width: 7, height: 7, background: i === index ? '#1E5EFF' : '#D6DCE5' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PROBLEMAS = [
  { t: 'Capital de giro travado', d: 'Empresas vendem a prazo e esperam 30, 60, 90 dias para receber — mesmo precisando do caixa agora.' },
  { t: 'Processo em papel e planilha', d: 'Emissão, aceite e registro de duplicatas ainda dependem de e-mail, PDF e conferência manual.' },
  { t: 'Fraude e duplicidade', d: 'Sem um registro eletrônico único e auditável, a mesma duplicata pode ser descontada mais de uma vez.' },
  { t: 'Crédito concentrado', d: 'Acesso à antecipação de recebíveis passa por poucos bancos e factorings, com taxas altas e pouca transparência.' },
];

const PASSOS = [
  { n: '1', t: 'Emissão', d: 'A empresa cadastra a duplicata; a NF-e é lida automaticamente.' },
  { n: '2', t: 'Registro', d: 'Roteamento automático para a registradora certa — B3, CERC, Núclea ou Grafeno.' },
  { n: '3', t: 'Leilão', d: 'Investidores dão lances; o menor deságio vence.' },
  { n: '4', t: 'Aceite', d: 'O sacado confirma eletronicamente, com prazo legal monitorado.' },
  { n: '5', t: 'Liquidação', d: 'Pix ou TED credita o cedente — sem esperar o vencimento.' },
];

const PERFIS = [
  { t: 'Empresas (cedentes)', d: 'Antecipam recebíveis sem depender de um único banco — emissão, registro e leilão em minutos.' },
  { t: 'Bancos e fundos', d: 'Compram com score de risco, aceite e compliance já calculados — menos due diligence título a título.' },
  { t: 'Sacados', d: 'Confirmam ou contestam cada duplicata antes que ela vire garantia de crédito, com prazos claros.' },
  { t: 'Seguradoras', d: 'Distribuem seguro de crédito integrado à operação, com prêmio calculado automaticamente por API.' },
];

const PILARES = [
  { t: 'Compliance com IA', d: 'Score de risco 0–100 combinando histórico interno, rede compartilhada, bureau de crédito e Open Finance — com revisão humana acima do limiar.' },
  { t: 'Multi-registradora', d: 'Roteamento automático entre B3, CERC, Núclea e Grafeno pelo melhor custo e confiabilidade.' },
  { t: 'PLD/KYC real', d: 'Triagem contra listas OFAC e ONU, KYC biométrico e monitoramento de atividade suspeita.' },
  { t: 'Conectores de ERP', d: 'Integrações reais com SAP, TOTVS e Omie para emitir direto do seu sistema.' },
];

export function LandingPage() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [ads, setAds] = useState<Advertisement[]>([]);

  useEffect(() => {
    fetch('/api/public/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/public/advertisements')
      .then((r) => r.json())
      .then((d) => setAds(d.ads ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="w-full text-navy overflow-x-hidden">
      <PublicNav />

      {/* HERO */}
      <div className="grid gap-10 px-14 py-20 max-w-[1360px] mx-auto items-center" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-chip text-blue text-[12.5px] font-bold mb-5.5">
            <span className="rounded-full bg-blue" style={{ width: 6, height: 6 }} />
            Infraestrutura para duplicata escritural
          </div>
          <div className="text-[52px] font-extrabold leading-[1.05] tracking-tight">Do recebível travado ao caixa em minutos.</div>
          <div className="text-lg text-textSecondary mt-5 leading-relaxed max-w-[520px]">
            A Lastro conecta empresas, investidores, sacados e seguradoras em um único fluxo digital — emissão, registro eletrônico, leilão e liquidação real via Pix, TED, boleto ou stablecoin, para investidor institucional local ou estrangeiro.
          </div>
          <div className="flex gap-3 mt-8">
            <Link to="/legal#contato" className="px-6 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px]">
              Falar com a Lastro
            </Link>
            <a href="#como-funciona" className="px-6 py-3.5 rounded-lg border border-inputBorder text-navy font-bold text-[15px]">
              Ver como funciona
            </a>
          </div>
        </div>

        <div className="bg-navy rounded-2xl p-7" style={{ boxShadow: '0 24px 60px rgba(11,31,58,0.18)' }}>
          <div className="text-[#9FB3D6] text-[12px] font-bold uppercase tracking-wide mb-5">Como a Lastro conecta o mercado</div>
          <div className="flex flex-col gap-2.5">
            {[
              ['Empresa (cedente)', 'Emite e antecipa a duplicata'],
              ['Registradora (B3/CERC/Núclea/Grafeno)', 'Registro eletrônico obrigatório'],
              ['Leilão de investidores', 'Precificação por deságio'],
              ['Sacado & seguradora', 'Aceite e proteção de crédito'],
            ].map(([label, desc], i) => (
              <div key={label} className="rounded-xl p-4" style={{ background: i === 2 ? '#1E5EFF' : 'rgba(255,255,255,0.06)' }}>
                <div className="font-bold text-[13.5px] text-white">{label}</div>
                <div className="text-[11.5px] mt-0.5" style={{ color: i === 2 ? 'rgba(255,255,255,0.85)' : '#9FB3D6' }}>
                  {desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* WHY NOW BAR */}
      <div className="px-14 py-7 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[1360px] mx-auto flex items-center justify-between flex-wrap gap-5">
          <div className="text-[12.5px] font-bold text-textTertiary uppercase tracking-wide">Lei 13.775/2018 tornou a duplicata escritural obrigatória via registradora</div>
          <div className="flex gap-8 font-mono-num text-[13px] font-semibold text-[#B8C2D4] flex-wrap">
            {['B3', 'CERC', 'Núclea', 'Grafeno (SPC)'].map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        </div>
      </div>

      {/* PROBLEMA */}
      <div className="px-14 py-20 max-w-[1360px] mx-auto">
        <div className="max-w-[640px] mb-12">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">O problema</div>
          <div className="text-[34px] font-extrabold tracking-tight">Recebível bom não deveria significar caixa parado.</div>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {PROBLEMAS.map((p) => (
            <div key={p.t} className="border border-border rounded-card p-6.5">
              <div className="w-[38px] h-[38px] rounded-[9px] bg-chip flex items-center justify-center mb-4">
                <span style={{ width: 14, height: 14, border: '2px solid #1E5EFF', borderRadius: 3 }} />
              </div>
              <div className="font-bold text-base mb-2">{p.t}</div>
              <div className="text-textSecondary text-[13.5px] leading-relaxed">{p.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* COMO FUNCIONA */}
      <div id="como-funciona" className="px-14 py-20 bg-[#F7F8FA] border-t border-b border-hairline scroll-mt-6">
        <div className="max-w-[1360px] mx-auto">
          <div className="max-w-[640px] mb-12">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Como funciona</div>
            <div className="text-[34px] font-extrabold tracking-tight">Da emissão ao caixa em cinco etapas.</div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {PASSOS.map((p, i) => (
              <div key={p.t} className="relative">
                <div className="bg-white border border-border rounded-card p-5.5 h-full">
                  <div className="w-9 h-9 rounded-full bg-navy text-white flex items-center justify-center font-bold text-[14px] mb-4">{p.n}</div>
                  <div className="font-bold text-[14.5px] mb-1.5">{p.t}</div>
                  <div className="text-textSecondary text-[12.5px] leading-relaxed">{p.d}</div>
                </div>
                {i < PASSOS.length - 1 && (
                  <div className="hidden lg:block absolute top-[34px] -right-2.5 text-textTertiary font-bold text-base">→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PARA CADA PERFIL */}
      <div className="px-14 py-20 max-w-[1360px] mx-auto">
        <div className="max-w-[640px] mb-12">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Uma plataforma, quatro pontas</div>
          <div className="text-[34px] font-extrabold tracking-tight">Feita para quem participa da operação — não só para quem vende.</div>
        </div>
        <div className="grid gap-4.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {PERFIS.map((p) => (
            <div key={p.t} className="bg-white border border-border rounded-card p-6">
              <div className="w-[34px] h-[34px] rounded-lg bg-chip flex items-center justify-center mb-3.5">
                <span style={{ width: 12, height: 12, border: '2px solid #1E5EFF', borderRadius: 2 }} />
              </div>
              <div className="font-bold text-[15px] mb-2">{p.t}</div>
              <div className="text-textSecondary text-[13px] leading-relaxed">{p.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* PRODUTO & TECNOLOGIA */}
      <div className="px-14 py-20 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[1360px] mx-auto">
          <div className="max-w-[640px] mb-12">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Produto</div>
            <div className="text-[34px] font-extrabold tracking-tight">O que torna a operação segura em escala.</div>
          </div>
          <div className="grid gap-4.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {PILARES.map((p) => (
              <div key={p.t} className="bg-white border border-border rounded-card p-6">
                <div className="w-[34px] h-[34px] rounded-lg bg-chip flex items-center justify-center mb-3.5">
                  <span style={{ width: 12, height: 12, background: '#1E5EFF', transform: 'rotate(45deg)' }} />
                </div>
                <div className="font-bold text-[15px] mb-2">{p.t}</div>
                <div className="text-textSecondary text-[13px] leading-relaxed">{p.d}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link to="/developers" className="text-[13px] font-bold text-blue">
              Ver a API completa para desenvolvedores →
            </Link>
          </div>
        </div>
      </div>

      {/* NÚMEROS REAIS (live) */}
      <div className="bg-navy px-14 py-16 text-white">
        <div className="max-w-[1360px] mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
            <div>
              <div className="text-[13px] font-bold text-[#4C8CFF] uppercase tracking-wide mb-2">Transparência</div>
              <div className="text-[26px] font-extrabold tracking-tight">Números reais, calculados ao vivo — não são meta de marketing.</div>
            </div>
            <Link to="/transparencia" className="text-[13px] font-bold text-[#4C8CFF] whitespace-nowrap">
              Ver todos os números →
            </Link>
          </div>
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div>
              <div className="text-[38px] font-extrabold tracking-tight">{stats?.volumeEmitidoFmt ?? '—'}</div>
              <div className="text-[#9FB3D6] text-[13.5px] mt-2">em duplicatas registradas na plataforma</div>
            </div>
            <div>
              <div className="text-[38px] font-extrabold tracking-tight">{stats ? stats.totalDuplicatas : '—'}</div>
              <div className="text-[#9FB3D6] text-[13.5px] mt-2">duplicatas emitidas</div>
            </div>
            <div>
              <div className="text-[38px] font-extrabold tracking-tight">{stats ? stats.totalCedentes : '—'}</div>
              <div className="text-[#9FB3D6] text-[13.5px] mt-2">empresas cedentes</div>
            </div>
            <div>
              <div className="text-[38px] font-extrabold tracking-tight">{stats ? `${stats.taxaInadimplenciaPct}%` : '—'}</div>
              <div className="text-[#9FB3D6] text-[13.5px] mt-2">taxa de inadimplência</div>
            </div>
          </div>
        </div>
      </div>

      <AdCarousel ads={ads} />

      {/* CTA FINAL */}
      <div className="px-14 py-20 text-center bg-[#F7F8FA]">
        <div className="text-[32px] font-extrabold tracking-tight">Quer saber mais sobre a Lastro?</div>
        <div className="text-textSecondary text-[15px] mt-2.5">Fale com nosso time — parcerias, imprensa ou dúvidas gerais sobre a plataforma.</div>
        <div className="flex gap-3 justify-center mt-6.5">
          <Link to="/legal#contato" className="px-6.5 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px]">
            Falar com a Lastro
          </Link>
          <Link to="/precos" className="px-6.5 py-3.5 rounded-lg border border-inputBorder text-navy font-bold text-[15px]">
            Ver modelo de receita
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
