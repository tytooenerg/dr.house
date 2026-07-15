import { Link } from 'react-router-dom';
import { PublicNav, PublicFooter } from './PublicChrome';

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
          <div className="text-[40px] font-extrabold tracking-tight mb-3">Você só paga quando opera.</div>
          <div className="text-textSecondary text-base max-w-[600px] mx-auto">Sem mensalidade para começar. A Lastro ganha uma fração pequena de cada operação — sem carregar o risco de crédito.</div>
        </div>

        <div className="grid gap-5 mb-16" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {PLANS.map((p) => (
            <div key={p.title} className="rounded-2xl p-8 relative" style={{ border: p.highlighted ? '2px solid #1E5EFF' : '1px solid #E4E8EE' }}>
              {p.highlighted && <div className="absolute -top-3 left-6 bg-blue text-white text-[11px] font-bold px-3 py-1 rounded-md">Mais popular</div>}
              <div className="font-bold text-[13px] text-textSecondary uppercase tracking-wide mb-3.5">{p.title}</div>
              <div className="text-[34px] font-extrabold mb-1.5">{p.price}</div>
              <div className="text-textSecondary text-[13.5px] mb-5">{p.hint}</div>
              <div className="flex flex-col gap-2.5 text-[13.5px] text-[#3D4658]">
                {p.features.map((f) => (
                  <div key={f}>✓ {f}</div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-bg rounded-2xl p-8 flex items-center justify-between flex-wrap gap-5">
          <div>
            <div className="font-bold text-[17px] mb-1.5">Seguro sobre o recebível</div>
            <div className="text-textSecondary text-sm max-w-[520px]">Prêmio de referência 0,6% do valor, cobrado pela seguradora parceira — a Lastro recebe apenas comissão de distribuição, sem risco de sinistro.</div>
          </div>
          <Link to="/" className="px-5.5 py-3 rounded-lg bg-blue text-white font-bold text-sm whitespace-nowrap">
            Simular uma operação
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
