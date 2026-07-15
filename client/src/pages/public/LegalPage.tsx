import { PublicNav, PublicFooter } from './PublicChrome';

const TERMOS = [
  { title: '1. O que é a Lastro.', text: 'A Lastro é uma plataforma de infraestrutura tecnológica que conecta empresas cedentes, empresas sacadas, instituições financeiras e fundos de investimento para emissão, registro, negociação e liquidação de duplicatas escriturais. A Lastro não é uma instituição financeira, não concede crédito e não assume risco de crédito das operações intermediadas.' },
  { title: '2. Papel de cada parte.', text: 'Operações de crédito, antecipação e financiamento são realizadas exclusivamente por instituições financeiras e fundos parceiros, devidamente autorizados pelo Banco Central do Brasil e pela CVM quando aplicável. A Lastro atua como correspondente tecnológico e camada de originação, padronização e conformidade.' },
  { title: '3. Registro escritural.', text: 'Toda duplicata emitida através da plataforma é registrada em uma ou mais entidades registradoras autorizadas pelo Banco Central (CERC, B3, Núclea e demais homologadas), conforme a Resolução BCB nº 339/2023 e normativos correlatos.' },
  { title: '4. Responsabilidade do sacado.', text: 'A manifestação de aceite ou contestação da duplicata pelo sacado, dentro do prazo legal, é condição essencial para a validade plena do título como garantia de operações de crédito.' },
  { title: '5. Seguro sobre recebíveis.', text: 'Quando contratado, o seguro sobre o recebível é fornecido por seguradora parceira terceirizada, regulada pela SUSEP. A Lastro atua exclusivamente como correspondente na distribuição, recebendo comissão comercial, sem qualquer responsabilidade sobre sinistros.' },
  { title: '6. Uso da plataforma.', text: 'É vedado o uso da plataforma para emissão de duplicatas sem lastro comercial real, duplicidade proposital de títulos ou qualquer prática que viole a legislação de duplicatas escriturais (Lei nº 13.775/2018 e alterações).' },
];

const PRIVACIDADE = [
  { title: '1. Dados coletados.', text: 'Coletamos dados cadastrais (CNPJ, razão social, representantes legais), dados financeiros necessários à análise de risco e score de crédito, e dados de uso da plataforma, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).' },
  { title: '2. Finalidade.', text: 'Os dados são usados para viabilizar a emissão, registro, negociação, liquidação e monitoramento de duplicatas, incluindo checagens de duplicidade e prevenção à fraude junto às registradoras autorizadas.' },
  { title: '3. Compartilhamento.', text: 'Dados de score e status de aceite são compartilhados com financiadores participantes do marketplace, exclusivamente para fins de precificação e decisão de compra da duplicata. Dados societários são compartilhados com registradoras (CERC, B3, Núclea) conforme exigido pela regulação do Banco Central.' },
  { title: '4. Direitos do titular.', text: 'Você pode solicitar acesso, correção, portabilidade ou eliminação de seus dados a qualquer momento pelo canal de contato abaixo, exceto quando a retenção for exigida por obrigação regulatória (ex: trilha de auditoria de operações de crédito).' },
  { title: '5. Segurança.', text: 'Dados são criptografados em trânsito e em repouso, com controle de acesso segregado por papel (cedente, sacado, financiador) e monitoramento contínuo de acesso indevido.' },
];

const STATUS_ROWS = ['API de emissão e registro', 'Marketplace e leilão', 'Conexão CERC / B3 / Núclea', 'Score de risco e IA antifraude', 'Liquidação e pagamentos'];

const CONTATOS = [
  { title: 'Comercial e parcerias', desc: 'Bancos, FIDCs e fundos interessados em integrar o marketplace.', email: 'comercial@lastro.com.br' },
  { title: 'Suporte técnico', desc: 'Dúvidas sobre integração de API ou uso da plataforma.', email: 'suporte@lastro.com.br' },
  { title: 'Compliance e privacidade', desc: 'Solicitações de dados (LGPD) e questões regulatórias.', email: 'compliance@lastro.com.br' },
  { title: 'Imprensa e investidores', desc: 'Pauta, entrevistas e relações com investidores.', email: 'contato@lastro.com.br' },
];

export function LegalPage() {
  return (
    <div className="w-full text-navy min-h-screen">
      <PublicNav active="legal" />

      <div className="grid gap-14 max-w-[1100px] mx-auto px-14 py-14" style={{ gridTemplateColumns: '220px 1fr' }}>
        <div className="flex flex-col gap-1 sticky top-14 self-start">
          {['termos', 'privacidade', 'status', 'contato'].map((id) => (
            <a key={id} href={`#${id}`} className="px-3 py-2.5 rounded-lg font-semibold text-sm text-navy capitalize">
              {id === 'termos' ? 'Termos de uso' : id}
            </a>
          ))}
        </div>

        <div className="min-w-0">
          <div id="termos" className="mb-16 scroll-mt-6">
            <div className="text-[13px] font-bold text-blue uppercase tracking-wide mb-2.5">Legal</div>
            <div className="text-[34px] font-extrabold tracking-tight mb-2">Termos de uso</div>
            <div className="text-textTertiary text-[13px] mb-7">Última atualização: 1 de julho de 2026</div>
            <div className="flex flex-col gap-5 text-[15px] text-[#3D4658] leading-relaxed">
              {TERMOS.map((t) => (
                <div key={t.title}>
                  <b>{t.title}</b> {t.text}
                </div>
              ))}
            </div>
          </div>

          <div id="privacidade" className="mb-16 scroll-mt-6">
            <div className="text-[34px] font-extrabold tracking-tight mb-2">Política de privacidade</div>
            <div className="text-textTertiary text-[13px] mb-7">Última atualização: 1 de julho de 2026</div>
            <div className="flex flex-col gap-5 text-[15px] text-[#3D4658] leading-relaxed">
              {PRIVACIDADE.map((t) => (
                <div key={t.title}>
                  <b>{t.title}</b> {t.text}
                </div>
              ))}
            </div>
          </div>

          <div id="status" className="mb-16 scroll-mt-6">
            <div className="text-[34px] font-extrabold tracking-tight mb-2">Status da plataforma</div>
            <div className="flex items-center gap-2.5 mb-7">
              <span className="rounded-full bg-green" style={{ width: 9, height: 9 }} />
              <span className="text-[14.5px] font-bold text-green">Todos os sistemas operacionais</span>
            </div>
            <div className="border border-border rounded-card overflow-hidden">
              {STATUS_ROWS.map((r) => (
                <div key={r} className="flex justify-between items-center px-5.5 py-4.5 border-b border-hairline last:border-b-0">
                  <div className="font-semibold text-[14.5px]">{r}</div>
                  <div className="flex items-center gap-2 text-[13px] text-green font-bold">
                    <span className="rounded-full bg-green" style={{ width: 7, height: 7 }} />
                    Operacional
                  </div>
                </div>
              ))}
            </div>
            <div className="text-textTertiary text-[13px] mt-4">Sem incidentes nos últimos 90 dias.</div>
          </div>

          <div id="contato" className="scroll-mt-6">
            <div className="text-[34px] font-extrabold tracking-tight mb-7">Contato</div>
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {CONTATOS.map((c) => (
                <div key={c.email} className="border border-border rounded-card p-6">
                  <div className="font-bold text-[15px] mb-1.5">{c.title}</div>
                  <div className="text-textSecondary text-sm mb-3">{c.desc}</div>
                  <a href={`mailto:${c.email}`} className="text-sm font-bold text-blue">
                    {c.email}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
