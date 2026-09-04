import { Link } from 'react-router-dom';
import { PublicNav, PublicFooter } from './PublicChrome';

const PILLARS = [
  { title: 'Emissão & Registro', desc: 'Emita duplicatas escriturais direto do seu sistema, com registro automático em CERC, B3 e Núclea.' },
  { title: 'Marketplace & Funding', desc: 'Conecte cada duplicata a uma rede de bancos, FIDCs e fintechs em leilão — melhor taxa por competição.' },
  { title: 'Risco & Score', desc: 'Score de crédito do sacado em tempo real para precificar e aprovar cada operação automaticamente.' },
  { title: 'Compliance', desc: 'Verificação de duplicidade em tempo real e trilha de auditoria completa, alinhadas ao cronograma do BC.' },
  { title: 'Seguro de Recebíveis', desc: 'Proteção contra inadimplência do sacado embutida na operação, com prêmio calculado por API.' },
];

const TRUST = [
  { title: 'Empresas (cedentes)', desc: 'Emitem a duplicata com registro escritural automático e veem em tempo real se o sacado já aceitou — sem depender de um único banco parceiro para antecipar.' },
  { title: 'Bancos e fundos', desc: 'Compram com score do sacado, status de aceite e estágio de provisionamento já calculados — reduzindo a due diligence título a título.' },
  { title: 'Sacados', desc: 'Confirmam ou contestam cada duplicata antes que ela vire garantia de crédito, com prazos claros — evita cobrança sobre título indevido.' },
];

const STATS = [
  { value: 'R$ 11 tri', desc: 'mercado potencial em recebíveis mercantis no Brasil, segundo o Banco Central' },
  { value: '10–15%', desc: 'das duplicatas emitidas hoje chegam ao mercado financeiro como garantia de crédito' },
  { value: '2M', desc: 'empresas emissoras de duplicatas projetadas no ecossistema escritural' },
  { value: '2027', desc: 'ano em que a obrigatoriedade chega às médias e pequenas empresas' },
];

// Achado corrigido (auditoria de conformidade): esta lista incluía "TAG", "CRDC" e
// "Quicksoft" — nomes nunca confirmados como registradoras homologadas de duplicata
// escritural — junto com uma contagem exata ("sete") não verificável. Mantida em sincronia
// manual com as 4 que server/src/lib/registradoras.ts de fato modela e roteia operações
// reais (CERC, B3, Núclea, Grafeno/SPC — Resolução BCB nº 339/2023); o card "+ novas"
// abaixo já comunica honestamente que mais podem ser homologadas sem precisar nomear ou
// contar as que ainda não são reais.
const REGISTRADORAS = ['CERC', 'B3', 'Núclea', 'Grafeno (SPC)'];

const ENDPOINTS = [
  { method: 'POST', path: '/v1/duplicatas', desc: 'Emite e registra uma duplicata escritural' },
  { method: 'GET', path: '/v1/duplicatas/:id', desc: 'Consulta status, aceite e titularidade' },
  { method: 'POST', path: '/v1/leiloes/:id/lances', desc: 'Envia um lance no leilão de uma duplicata' },
  { method: 'GET', path: '/v1/sacados/:cnpj/score', desc: 'Retorna o score de risco do sacado' },
  { method: 'POST', path: '/v1/webhooks', desc: 'Registra uma URL para receber eventos em tempo real' },
];

const PRICING = [
  { name: 'Starter', desc: 'Para quem está testando a integração', price: '0,35%', priceHint: 'por operação, sem mensalidade', features: ['Emissão e registro escritural', 'Marketplace com leilão', 'Chave de teste ilimitada'], highlighted: false },
  { name: 'Growth', desc: 'Para operação recorrente de médio volume', price: '0,25%', priceHint: 'por operação + R$ 890/mês', features: ['Tudo do Starter', 'Webhooks e conciliação automática', 'Score de risco em lote', 'Suporte prioritário'], highlighted: true },
  { name: 'Enterprise', desc: 'Para bancos, fundos e grandes volumes', price: 'Sob consulta', priceHint: 'taxa negociada por volume', features: ['Tudo do Growth', 'SLA dedicado', 'Integração assistida com seu ERP/core', 'Gerente de conta dedicado'], highlighted: false },
];

export function DevelopersPage() {
  return (
    <div className="w-full text-navy overflow-x-hidden">
      <PublicNav active="developers" />

      <div className="grid gap-10 px-14 py-20 max-w-[1360px] mx-auto items-center" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-chip text-blue text-[12.5px] font-bold mb-5.5">
            <span className="rounded-full bg-blue" style={{ width: 6, height: 6 }} />
            O hub que conecta todas as registradoras do BCB
          </div>
          <div className="text-[52px] font-extrabold leading-[1.05] tracking-tight">A infraestrutura de duplicatas do Brasil.</div>
          <div className="text-lg text-textSecondary mt-5 leading-relaxed max-w-[520px]">
            Uma única API para emitir, registrar, financiar e segurar duplicatas escriturais em qualquer registradora autorizada pelo Banco Central — para bancos médios, fintechs, FIDCs e
            fundos que não têm escala para integrar um por um.
          </div>
          <div className="flex gap-3 mt-8">
            <Link to="/login" className="px-6 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px]">
              Começar a integrar
            </Link>
            <Link to="/docs" className="px-6 py-3.5 rounded-lg border border-inputBorder text-navy font-bold text-[15px]">
              Ver documentação
            </Link>
          </div>
        </div>

        <div className="bg-navy rounded-2xl p-6.5" style={{ boxShadow: '0 24px 60px rgba(11,31,58,0.18)' }}>
          <div className="flex gap-1.5 mb-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className="rounded-full" style={{ width: 10, height: 10, background: '#3D4658' }} />
            ))}
          </div>
          <pre className="font-mono-num text-[13px] leading-loose text-[#C7D6FF] whitespace-pre">{`curl https://api.lastro.com.br/v1/duplicatas \\
  -H "Authorization: Bearer sk_live_..." \\
  -d sacado_cnpj="12.345.678/0001-90" \\
  -d valor="84500.00" \\
  -d vencimento="2026-08-12" \\
  -d seguro="true"`}</pre>
          <div className="h-px my-4.5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <div className="font-mono-num text-[12.5px]">
            <span style={{ color: '#6FCF97' }}>200 OK</span>
            <span className="text-textTertiary"> · registrado na CERC</span>
          </div>
          <div className="font-mono-num text-[12.5px] text-textTertiary">{'{ "id": "dup_9f2a", "status": "registrada", "leilao": "aberto" }'}</div>
        </div>
      </div>

      <div className="px-14 py-7 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[1360px] mx-auto flex items-center justify-between flex-wrap gap-5">
          <div className="text-[12.5px] font-bold text-textTertiary uppercase tracking-wide">Feito para quem não tem escala para negociar direto com uma registradora</div>
          <div className="flex gap-8 font-mono-num text-[13px] font-semibold text-[#B8C2D4] flex-wrap">
            {['ERP Fluxo', 'PagaCerto', 'Banco Trilha', 'Girocap', 'Nortis Capital'].map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-14 py-20 max-w-[1360px] mx-auto">
        <div className="max-w-[640px] mb-12">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Plataforma</div>
          <div className="text-[34px] font-extrabold tracking-tight">Cinco APIs, uma única integração.</div>
          <div className="text-base text-textSecondary mt-3 leading-relaxed">Cada peça do ciclo de vida da duplicata escritural, exposta como API — combine só o que seu produto precisa.</div>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {PILLARS.map((p) => (
            <div key={p.title} className="border border-border rounded-card p-6.5">
              <div className="w-[38px] h-[38px] rounded-[9px] bg-chip flex items-center justify-center mb-4">
                <span style={{ width: 14, height: 14, border: '2px solid #1E5EFF', borderRadius: 3 }} />
              </div>
              <div className="font-bold text-base mb-2">{p.title}</div>
              <div className="text-textSecondary text-[13.5px] leading-relaxed">{p.desc}</div>
            </div>
          ))}
          <div className="rounded-card p-6.5 bg-navy">
            <div className="font-bold text-base mb-2 text-white">Sua ideia aqui</div>
            <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed mb-4">Fale com nosso time de parcerias para desenhar o fluxo do seu produto sobre a Lastro.</div>
            <div className="text-[13px] font-bold text-[#4C8CFF]">Ver documentação →</div>
          </div>
        </div>
      </div>

      <div className="px-14 py-20 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[1360px] mx-auto">
          <div className="max-w-[640px] mb-12">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">A ponte</div>
            <div className="text-[34px] font-extrabold tracking-tight">Confiança e segurança para todas as partes.</div>
            <div className="text-base text-textSecondary mt-3 leading-relaxed">A Lastro conecta quatro pontas que hoje não confiam plenamente umas nas outras — cada uma vê exatamente o que precisa para decidir com segurança.</div>
          </div>
          <div className="grid gap-4.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {TRUST.map((t) => (
              <div key={t.title} className="bg-white border border-border rounded-card p-6">
                <div className="w-[34px] h-[34px] rounded-lg bg-chip flex items-center justify-center mb-3.5">
                  <span style={{ width: 12, height: 12, border: '2px solid #1E5EFF', borderRadius: 2 }} />
                </div>
                <div className="font-bold text-[15px] mb-2">{t.title}</div>
                <div className="text-textSecondary text-[13px] leading-relaxed">{t.desc}</div>
              </div>
            ))}
            <div className="rounded-card p-6 bg-navy">
              <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center mb-3.5" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <span style={{ width: 12, height: 12, background: '#4C8CFF', transform: 'rotate(45deg)' }} />
              </div>
              <div className="font-bold text-[15px] mb-2 text-white">Banco Central</div>
              <div className="text-[#9FB3D6] text-[13px] leading-relaxed">Recebe trilha de auditoria completa e registro interoperável em CERC, B3 e Núclea — unicidade do título garantida, sem duplicidade.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-navy px-14 py-16 text-white">
        <div className="max-w-[1360px] mx-auto grid gap-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {STATS.map((s) => (
            <div key={s.value}>
              <div className="text-[38px] font-extrabold tracking-tight">{s.value}</div>
              <div className="text-[#9FB3D6] text-[13.5px] mt-2">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-14 py-16 max-w-[1360px] mx-auto">
        <div className="grid gap-10 items-center" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Regulação</div>
            <div className="text-[30px] font-extrabold tracking-tight mb-4">Conector universal, não mais um silo.</div>
            <div className="text-textSecondary text-[15px] leading-relaxed">
              Grandes bancos já fecham parceria individual com uma escrituradora só para seus próprios clientes. A Lastro faz o caminho inverso: uma integração conecta você às
              registradoras autorizadas pelo Banco Central (CERC, B3, Núclea e demais em processo de homologação, incluindo a Grafeno/SPC), em conformidade com a Resolução BCB nº 339/2023 e nº 540/2025 — sem escolher um silo e ficar preso a ele.
            </div>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {REGISTRADORAS.map((r) => (
              <div key={r} className="border border-border rounded-xl p-4 text-center">
                <div className="font-extrabold text-sm">{r}</div>
              </div>
            ))}
            <div className="border border-border rounded-xl p-4 text-center bg-chip">
              <div className="font-extrabold text-sm text-blue">+ novas</div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-14 py-20 max-w-[1360px] mx-auto">
        <div className="max-w-[640px] mb-12">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Preços</div>
          <div className="text-[34px] font-extrabold tracking-tight">Só paga quem transaciona.</div>
          <div className="text-base text-textSecondary mt-3 leading-relaxed">Sem mensalidade para começar a integrar — a Lastro ganha quando você ganha.</div>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {PRICING.map((p) => (
            <div key={p.name} className="rounded-card p-7 relative" style={{ border: p.highlighted ? '2px solid #1E5EFF' : '1px solid #E4E8EE' }}>
              {p.highlighted && <div className="absolute -top-3 left-6 bg-blue text-white text-[11px] font-bold px-2.5 py-1 rounded-md">MAIS USADO</div>}
              <div className="font-bold text-[15px] mb-1.5">{p.name}</div>
              <div className="text-textSecondary text-[13px] mb-5">{p.desc}</div>
              <div className="text-[30px] font-extrabold mb-1">{p.price}</div>
              <div className="text-textTertiary text-[12.5px] mb-5">{p.priceHint}</div>
              <div className="text-textSecondary text-[13px] leading-loose">
                {p.features.map((f) => (
                  <div key={f}>✓ {f}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-14 py-16 bg-[#F7F8FA] border-t border-b border-hairline">
        <div className="max-w-[1360px] mx-auto">
          <div className="max-w-[640px] mb-8">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Referência</div>
            <div className="text-[30px] font-extrabold tracking-tight">Endpoints principais.</div>
          </div>
          <div className="bg-white border border-border rounded-card overflow-hidden">
            <div className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-[11.5px] font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: '0.5fr 1.5fr 2fr' }}>
              <div>Método</div>
              <div>Endpoint</div>
              <div>Descrição</div>
            </div>
            {ENDPOINTS.map((e) => (
              <div key={e.path} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13.5px]" style={{ gridTemplateColumns: '0.5fr 1.5fr 2fr' }}>
                <div className="font-mono-num font-bold" style={{ color: e.method === 'POST' ? '#0A5C36' : '#1E5EFF' }}>
                  {e.method}
                </div>
                <div className="font-mono-num">{e.path}</div>
                <div className="text-textSecondary">{e.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-14 py-16 max-w-[1360px] mx-auto">
        <div className="max-w-[640px] mb-10">
          <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Sem virar cliente do marketplace</div>
          <div className="text-[30px] font-extrabold tracking-tight">Só precisa do dado, não da esteira inteira.</div>
          <div className="text-textSecondary text-[15px] mt-3 leading-relaxed">
            9 capacidades internas da Lastro são vendidas avulsas, por chamada — uma conta "só-API" gera a chave em minutos, sem passar pelo cadastro de cedente/investidor nem por KYB.
          </div>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-green mb-2">GET</div>
            <div className="font-bold text-base mb-2">Score API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Score interno + sinais de rede entre CNPJs, na hora — R$ 1,50 por consulta.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">GET /v1/sacados/:cnpj/score</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">PLD Screening API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Checagem contra listas de sanções, com segunda opinião de IA em casos ambíguos — R$ 2,00 por triagem.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/pld/triagem</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Registro API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">O mesmo roteamento inteligente entre CERC/B3/Núclea/Grafeno que a Lastro usa internamente, sem entrar no marketplace — R$ 3,50 por registro.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/registro</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Judicial Records API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Execuções, falência/recuperação judicial e protestos por CNPJ — R$ 4,00 por consulta.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/judicial/consulta</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Fraud Screening API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Autorrelacionamento e concentração anômala sobre a sua própria transação e histórico — R$ 2,50 por avaliação.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/fraude/avaliar</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Document Intelligence API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Extração de NF-e ou análise de cláusulas de contrato via IA, direto do PDF/imagem/XML — R$ 3,00 por documento.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/documentos/analisar</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Reconciliation API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Envie um extrato OFX e sua lista de lançamentos esperados, receba o que bateu e o que ficou pendente — R$ 1,50 por conciliação.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/conciliacao</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-blue mb-2">POST</div>
            <div className="font-bold text-base mb-2">Suitability API</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Classificação conservador/moderado/arrojado, estilo CVM, para o cliente final da sua própria plataforma — R$ 1,00 por avaliação.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">POST /v1/suitability/avaliar</div>
          </div>
          <div className="border border-border rounded-card p-6.5">
            <div className="font-mono-num text-[11.5px] font-bold text-green mb-2">GET</div>
            <div className="font-bold text-base mb-2">Lastro Index</div>
            <div className="text-textSecondary text-[13.5px] leading-relaxed mb-3">Deságio médio e taxa de inadimplência por rating, calculado ao vivo sobre o volume real da Lastro — R$ 5,00 por consulta.</div>
            <div className="font-mono-num text-[12px] text-textTertiary">GET /v1/index</div>
          </div>
        </div>
        <div className="mt-6">
          <Link to="/login?mode=register&role=api_partner" className="px-6 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px] inline-block">
            Criar conta só-API
          </Link>
        </div>
      </div>

      <div className="px-14 py-20 text-center bg-[#F7F8FA]">
        <div className="text-[32px] font-extrabold tracking-tight">Pronto para construir sobre a Lastro?</div>
        <div className="text-textSecondary text-[15px] mt-2.5">Chaves de teste em minutos, sem burocracia.</div>
        <div className="flex gap-3 justify-center mt-6.5">
          <Link to="/login" className="px-6.5 py-3.5 rounded-lg bg-blue text-white font-bold text-[15px]">
            Criar conta de desenvolvedor
          </Link>
          <div className="px-6.5 py-3.5 rounded-lg border border-inputBorder text-navy font-bold text-[15px]">Falar com vendas</div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
