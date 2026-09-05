import { Link } from 'react-router-dom';
import { PublicNav, PublicFooter } from './PublicChrome';
import { PALETTE } from '../../lib/palette';

const PLANS = [
  {
    title: 'Empresas (cedente/sacado)',
    price: '0,35%',
    hint: 'sobre o valor antecipado, cobrado só na liquidação',
    features: ['Emissão e registro escritural ilimitados', 'Checklist de Lastro e score de risco', 'Portal do sacado incluído', 'Sem taxa de adesão'],
    highlighted: false,
  },
  {
    title: 'Bancos e fundos',
    price: 'Spread do leilão',
    hint: 'variável, você define sua taxa mínima competindo por volume',
    features: ['Acesso ao marketplace de leilão', 'Score de risco e sinais de IA por sacado', 'Automação de lances por classe de risco', 'Central de compliance e trilha de auditoria'],
    highlighted: true,
  },
  {
    title: 'API / Integração',
    price: 'Por volume',
    hint: 'para bancos e fintechs que integram sua própria esteira de crédito',
    features: ['Ambiente de testes (playground)', 'Webhooks de status de aceite e liquidação', 'SLA e suporte técnico dedicado', 'Onboarding assistido'],
    highlighted: false,
  },
];

export function PrecosPage() {
  return (
    <div className="w-full text-navy min-h-screen">
      <PublicNav active="precos" />

      <div className="max-w-[1100px] mx-auto px-14 py-[72px]">
        <div className="text-center mb-14">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-3">Preços</div>
          <div className="text-[34px] font-extrabold tracking-tight mb-3">Você só paga quando opera.</div>
          <div className="text-textSecondary text-base max-w-[600px] mx-auto">Sem mensalidade para começar. A Lastro ganha uma fração pequena de cada operação — sem carregar o risco de crédito.</div>
        </div>

        <div className="grid gap-5 mb-16" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {PLANS.map((p) => (
            <div key={p.title} className="rounded-2xl p-8 relative" style={{ border: p.highlighted ? `2px solid ${PALETTE.blue}` : `1px solid ${PALETTE.border}` }}>
              {p.highlighted && <div className="absolute -top-3 left-6 bg-blue text-white text-[11.5px] font-bold px-3 py-1 rounded-md">Mais popular</div>}
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">{p.title}</div>
              <div className="text-[34px] font-extrabold mb-1.5">{p.price}</div>
              <div className="text-textSecondary text-[13px] mb-5">{p.hint}</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                {p.features.map((f) => (
                  <div key={f}>✓ {f}</div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-16">
          <div className="text-center mb-8">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Produtos de dados</div>
            <div className="text-[26px] font-extrabold tracking-tight mb-2">Só precisa dos dados, não do marketplace?</div>
            <div className="text-textSecondary text-[15px] max-w-[560px] mx-auto">9 capacidades internas da Lastro vendidas avulsas, por chamada — sem virar cliente da plataforma, sem plano, sem contrato mínimo.</div>
          </div>
          <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Score API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 1,50</div>
              <div className="text-textSecondary text-[13px] mb-5">por consulta — GET /v1/sacados/:cnpj/score</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Score interno + sinais de rede entre CNPJs</div>
                <div>✓ Chave sandbox grátis pra testar</div>
                <div>✓ Sem mensalidade, cobrado só o que usar</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">PLD Screening API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 2,00</div>
              <div className="text-textSecondary text-[13px] mb-5">por triagem — POST /v1/pld/triagem</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Checagem contra listas OFAC/ONU (quando habilitado)</div>
                <div>✓ Segunda opinião de IA em casos ambíguos</div>
                <div>✓ Sem mensalidade, cobrado só o que usar</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Registro API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 3,50</div>
              <div className="text-textSecondary text-[13px] mb-5">por registro — POST /v1/registro</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Roteamento inteligente entre CERC/B3/Núclea/Grafeno</div>
                <div>✓ Checagem de duplicidade na registradora escolhida</div>
                <div>✓ Nunca entra no seu marketplace nem cria conta cedente</div>
              </div>
            </div>
          </div>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Judicial Records API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 4,00</div>
              <div className="text-textSecondary text-[13px] mb-5">por consulta — POST /v1/judicial/consulta</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Execuções, falência/recuperação judicial e protestos por CNPJ</div>
                <div>✓ Mesmo provedor que alimenta o motor de compliance interno</div>
                <div>✓ Sem mensalidade, cobrado só o que usar</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Fraud Screening API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 2,50</div>
              <div className="text-textSecondary text-[13px] mb-5">por avaliação — POST /v1/fraude/avaliar</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Detecta autorrelacionamento e concentração anômala</div>
                <div>✓ Mesma heurística que roda internamente sobre cada duplicata</div>
                <div>✓ Avalia sua própria transação e histórico, sem depender da Lastro</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Document Intelligence API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 3,00</div>
              <div className="text-textSecondary text-[13px] mb-5">por documento — POST /v1/documentos/analisar</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Extração de campos de NF-e ou análise de cláusulas de contrato</div>
                <div>✓ Leitura real via IA (PDF, imagem ou XML)</div>
                <div>✓ Envie o arquivo em Base64, receba o JSON estruturado</div>
              </div>
            </div>
          </div>
          <div className="grid gap-5 mt-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Reconciliation API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 1,50</div>
              <div className="text-textSecondary text-[13px] mb-5">por conciliação — POST /v1/conciliacao</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Envie seu extrato OFX e sua própria lista de lançamentos esperados</div>
                <div>✓ Recebe de volta o que bateu e o que ficou pendente dos dois lados</div>
                <div>✓ Não depende de você ter conta na Lastro</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Suitability API</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 1,00</div>
              <div className="text-textSecondary text-[13px] mb-5">por avaliação — POST /v1/suitability/avaliar</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Classificação conservador/moderado/arrojado, estilo CVM</div>
                <div>✓ Cálculo determinístico e explicável, sem caixa-preta</div>
                <div>✓ Avalie o cliente final da sua própria plataforma de investimento</div>
              </div>
            </div>
            <div className="rounded-2xl p-8 border border-border">
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">Lastro Index</div>
              <div className="text-[26px] font-extrabold mb-1.5">R$ 5,00</div>
              <div className="text-textSecondary text-[13px] mb-5">por consulta — GET /v1/index</div>
              <div className="flex flex-col gap-2.5 text-[13px] text-slate">
                <div>✓ Deságio médio e taxa de inadimplência por rating (AA/A/B/C)</div>
                <div>✓ Calculado ao vivo sobre o volume real transacionado na Lastro</div>
                <div>✓ Benchmark de mercado, não uma amostra ou estimativa</div>
              </div>
            </div>
          </div>
          <div className="text-center mt-6">
            <Link to="/login?mode=register&role=api_partner" className="px-5.5 py-3 rounded-lg bg-blue text-white font-bold text-sm inline-block">
              Criar conta só-API
            </Link>
          </div>
        </div>

        <div className="bg-bg rounded-2xl p-8 flex items-center justify-between flex-wrap gap-5">
          <div>
            <div className="font-bold text-[15px] mb-1.5">Seguro sobre o recebível</div>
            <div className="text-textSecondary text-sm max-w-[520px]">Prêmio de referência 0,6% do valor, cobrado pela seguradora parceira — a Lastro recebe apenas comissão de distribuição, sem risco de sinistro.</div>
          </div>
          <Link to="/login" className="px-5.5 py-3 rounded-lg bg-blue text-white font-bold text-sm whitespace-nowrap">
            Simular uma operação
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
