import { useEffect, useState } from 'react';
import { api, uploadFile } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface KycItem {
  label: string;
  status: string;
  bg: string;
  color: string;
  action: { label: string; key: string } | null;
}
interface ExtratoRow {
  data: string;
  descricao: string;
  valorFmt: string;
  isPositive: boolean;
  saldoFmt: string;
}
interface PixCharge {
  txid: string;
  valorFmt: string;
  status: 'ativa' | 'concluida' | 'expirada';
  simulado: boolean;
  brcode: string | null;
}
interface Boleto {
  nossoNumero: string;
  valorFmt: string;
  status: 'ativo' | 'pago' | 'expirado';
  simulado: boolean;
  linhaDigitavel: string | null;
  pdfUrl: string | null;
}
interface TedDeposit {
  referencia: string;
  valorFmt: string;
  status: 'ativo' | 'recebido' | 'expirado';
  simulado: boolean;
  banco: string;
  agencia: string;
  conta: string;
  favorecidoNome: string;
}
interface TedContaBancaria {
  banco: string;
  agencia: string;
  conta: string;
  tipoConta: 'corrente' | 'poupanca';
  titularNome: string;
  titularCnpj: string;
}
interface StablecoinDeposit {
  referencia: string;
  valorFmt: string;
  status: 'ativo' | 'recebido' | 'expirado';
  simulado: boolean;
  asset: string;
  network: string;
  endereco: string;
}
interface AccountData {
  kycChecklist: KycItem[];
  bankAccountDisplay: string;
  pixEnabled: boolean;
  pixChave: string | null;
  saldoDisponivelFmt: string;
  pixCharges: PixCharge[];
  boletoEnabled: boolean;
  boletos: Boleto[];
  tedEnabled: boolean;
  tedInstructionsAvailable: boolean;
  tedContaBancaria: TedContaBancaria | null;
  tedDeposits: TedDeposit[];
  stablecoinEnabled: boolean;
  stablecoinInstructionsAvailable: boolean;
  stablecoinAsset: string;
  stablecoinNetwork: string;
  stablecoinWalletEndereco: string | null;
  stablecoinDeposits: StablecoinDeposit[];
  settlementSpeed: 'd0' | 'd1';
  extrato: ExtratoRow[];
}

export function ContaPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [pixKeyInput, setPixKeyInput] = useState('');
  const [depositValor, setDepositValor] = useState('');
  const [boletoValor, setBoletoValor] = useState('');
  const [withdrawValor, setWithdrawValor] = useState('');
  const [tedDepositValor, setTedDepositValor] = useState('');
  const [tedWithdrawValor, setTedWithdrawValor] = useState('');
  const [tedContaForm, setTedContaForm] = useState<TedContaBancaria>({ banco: '', agencia: '', conta: '', tipoConta: 'corrente', titularNome: '', titularCnpj: '' });
  const [stablecoinDepositValor, setStablecoinDepositValor] = useState('');
  const [stablecoinWithdrawValor, setStablecoinWithdrawValor] = useState('');
  const [stablecoinWalletInput, setStablecoinWalletInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api.get<AccountData>('/account').then(setData);

  useEffect(() => {
    load();
  }, []);

  if (!data) return <PageSkeleton />;

  const runAction = async (key: string) => {
    if (key === 'docs') {
      await api.post('/account/kyc/docs');
      load();
    }
  };

  const enviarSelfie = async (file: File) => {
    setBusy(true);
    try {
      const res = await uploadFile('selfie_liveness', file);
      if (res.biometria) {
        setNotice(res.biometria.passed ? 'Prova de vida verificada com sucesso.' : 'Não foi possível confirmar a prova de vida — tente novamente com melhor iluminação.');
      } else {
        setNotice('Selfie enviada (modo simulado — nenhum provedor de biometria configurado no servidor).');
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  const setSpeed = async (speed: 'd0' | 'd1') => {
    const d = await api.post<AccountData>('/account/settlement-speed', { speed });
    setData(d);
  };

  const saveChave = async () => {
    if (!pixKeyInput.trim()) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/kyc/bank', { chave: pixKeyInput.trim() });
      setData(d);
      setPixKeyInput('');
    } finally {
      setBusy(false);
    }
  };

  const gerarDeposito = async () => {
    const valor = Number(depositValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const res = await api.post<AccountData & { txid: string; simulado: boolean; brcode: string | null }>('/account/deposit', { valor });
      setData(res);
      setDepositValor('');
      setNotice(res.simulado ? 'Cobrança criada em modo simulado — confirme abaixo para creditar o saldo.' : 'Cobrança Pix criada — pague o código copia-e-cola gerado.');
    } finally {
      setBusy(false);
    }
  };

  const confirmarSimulado = async (txid: string) => {
    setBusy(true);
    try {
      const d = await api.post<AccountData>(`/account/deposit/${txid}/confirm-simulado`);
      setData(d);
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const gerarBoleto = async () => {
    const valor = Number(boletoValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const res = await api.post<AccountData & { nossoNumero: string; simulado: boolean; pdfUrl: string | null }>('/account/deposit/boleto', { valor });
      setData(res);
      setBoletoValor('');
      setNotice(res.simulado ? 'Boleto criado em modo simulado — confirme abaixo para creditar o saldo.' : 'Boleto criado — a linha digitável e o PDF estão disponíveis abaixo.');
    } finally {
      setBusy(false);
    }
  };

  const confirmarBoletoSimulado = async (nossoNumero: string) => {
    setBusy(true);
    try {
      const d = await api.post<AccountData>(`/account/deposit/boleto/${nossoNumero}/confirm-simulado`);
      setData(d);
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };

  const sacar = async () => {
    const valor = Number(withdrawValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/withdraw', { valor });
      setData(d);
      setWithdrawValor('');
      setNotice('Saque solicitado via Pix.');
    } finally {
      setBusy(false);
    }
  };

  const gerarDepositoTed = async () => {
    const valor = Number(tedDepositValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const res = await api.post<AccountData & { instrucao: { simulado: boolean; banco: string; agencia: string; conta: string; favorecidoNome: string; referencia: string } }>(
        '/account/deposit/ted',
        { valor }
      );
      setData(res);
      setTedDepositValor('');
      setNotice(
        res.instrucao.simulado
          ? 'Instrução de TED gerada em modo simulado — configure TED_PSP_* ou LASTRO_TED_* para exibir dados bancários reais.'
          : `Transfira via TED para ${res.instrucao.banco} ag. ${res.instrucao.agencia} cc ${res.instrucao.conta}, referência ${res.instrucao.referencia} — a confirmação não é automática, aguarde nossa equipe validar o recebimento no extrato bancário.`
      );
    } finally {
      setBusy(false);
    }
  };

  const saveContaTed = async () => {
    if (!tedContaForm.banco.trim() || !tedContaForm.agencia.trim() || !tedContaForm.conta.trim() || !tedContaForm.titularNome.trim() || !tedContaForm.titularCnpj.trim()) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/kyc/bank-ted', tedContaForm);
      setData(d);
    } finally {
      setBusy(false);
    }
  };

  const sacarTed = async () => {
    const valor = Number(tedWithdrawValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/withdraw/ted', { valor });
      setData(d);
      setTedWithdrawValor('');
      setNotice('Saque solicitado via TED.');
    } finally {
      setBusy(false);
    }
  };

  const gerarDepositoStablecoin = async () => {
    const valor = Number(stablecoinDepositValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const res = await api.post<AccountData & { instrucao: { simulado: boolean; asset: string; network: string; endereco: string; referencia: string } }>(
        '/account/deposit/stablecoin',
        { valor }
      );
      setData(res);
      setStablecoinDepositValor('');
      setNotice(
        res.instrucao.simulado
          ? 'Endereço de depósito gerado em modo simulado — configure STABLECOIN_PSP_* ou LASTRO_STABLECOIN_WALLET_ADDRESS para exibir um endereço real.'
          : `Envie ${res.instrucao.asset} (rede ${res.instrucao.network}) para ${res.instrucao.endereco}, referência ${res.instrucao.referencia} — a confirmação não é automática sem um custodiante configurado, aguarde nossa equipe validar o recebimento na blockchain.`
      );
    } finally {
      setBusy(false);
    }
  };

  const saveWalletStablecoin = async () => {
    if (!stablecoinWalletInput.trim()) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/kyc/wallet-stablecoin', { endereco: stablecoinWalletInput.trim() });
      setData(d);
      setStablecoinWalletInput('');
    } finally {
      setBusy(false);
    }
  };

  const sacarStablecoin = async () => {
    const valor = Number(stablecoinWithdrawValor.replace(',', '.'));
    if (!valor || valor <= 0) return;
    setBusy(true);
    try {
      const d = await api.post<AccountData>('/account/withdraw/stablecoin', { valor });
      setData(d);
      setStablecoinWithdrawValor('');
      setNotice(`Saque solicitado via ${data.stablecoinAsset}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Conta & Liquidação" subtitle="Verificação da empresa, conta bancária e como a Lastro monetiza cada operação" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Verificação (KYC)</div>
          <div className="flex flex-col gap-3">
            {data.kycChecklist.map((k) => (
              <div key={k.label} className="flex items-center justify-between gap-2.5">
                <div className="text-[13.5px] font-semibold">{k.label}</div>
                <div className="flex items-center gap-2">
                  {k.action?.key === 'biometria' ? (
                    <label className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer">
                      {k.action.label}
                      <input
                        type="file"
                        accept="image/*"
                        capture="user"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) enviarSelfie(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  ) : (
                    k.action && (
                      <button type="button" onClick={() => runAction(k.action!.key)} className="px-2.5 py-1.5 rounded-md border-none bg-blue text-white text-[11.5px] font-bold cursor-pointer">
                        {k.action.label}
                      </button>
                    )
                  )}
                  <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: k.bg, color: k.color }}>
                    {k.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Conta Pix para liquidação</div>
          <div className="p-3.5 rounded-[10px] bg-[#F7F8FA] text-[13.5px] font-semibold mb-4">{data.bankAccountDisplay}</div>
          {!data.pixChave && (
            <div className="flex gap-2 mb-4">
              <input
                value={pixKeyInput}
                onChange={(e) => setPixKeyInput(e.target.value)}
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
              />
              <Button variant="primary" disabled={busy || !pixKeyInput.trim()} onClick={saveChave}>
                Salvar
              </Button>
            </div>
          )}
          <div className="font-bold text-[13px] mb-2.5">Velocidade de liquidação</div>
          <div className="flex gap-2">
            <Button variant={data.settlementSpeed === 'd0' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSpeed('d0')}>
              D+0 (na hora)
            </Button>
            <Button variant={data.settlementSpeed === 'd1' ? 'primary' : 'secondary'} className="flex-1" onClick={() => setSpeed('d1')}>
              D+1 (custo menor)
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-[15px]">Depositar via Pix</div>
            <div className="text-[13px] font-mono-num text-textSecondary">Saldo: {data.saldoDisponivelFmt}</div>
          </div>
          {!data.pixEnabled && (
            <div className="text-[12px] text-textSecondary mb-3">
              Modo simulado — nenhum PSP real configurado (PIX_PSP_*). O depósito precisa ser confirmado manualmente abaixo.
            </div>
          )}
          <div className="flex gap-2 mb-4">
            <input
              value={depositValor}
              onChange={(e) => setDepositValor(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
            />
            <Button variant="primary" disabled={busy || !depositValor} onClick={gerarDeposito}>
              Gerar cobrança
            </Button>
          </div>
          {notice && <div className="text-[12.5px] font-semibold text-blue mb-3">{notice}</div>}
          {data.pixCharges
            .filter((c) => c.status === 'ativa')
            .map((c) => (
              <div key={c.txid} className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-[#F7F8FA] mb-2 text-[12.5px]">
                <div>
                  <div className="font-semibold">{c.valorFmt}</div>
                  {c.brcode ? <div className="break-all text-[10.5px] text-textSecondary">{c.brcode}</div> : <div className="text-textSecondary">Aguardando pagamento (simulado)</div>}
                </div>
                {c.simulado && (
                  <button type="button" onClick={() => confirmarSimulado(c.txid)} className="px-2.5 py-1.5 rounded-md border-none bg-green text-white text-[11px] font-bold cursor-pointer whitespace-nowrap">
                    Confirmar (simulado)
                  </button>
                )}
              </div>
            ))}
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Sacar via Pix</div>
          {!data.pixChave ? (
            <div className="text-[13px] text-textSecondary">Cadastre uma chave Pix ao lado para poder sacar.</div>
          ) : (
            <>
              <div className="text-[12.5px] text-textSecondary mb-3">Enviado para {data.pixChave}{!data.pixEnabled && ' (simulado)'}</div>
              <div className="flex gap-2">
                <input
                  value={withdrawValor}
                  onChange={(e) => setWithdrawValor(e.target.value)}
                  placeholder="Valor (R$)"
                  inputMode="decimal"
                  className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
                />
                <Button variant="primary" disabled={busy || !withdrawValor} onClick={sacar}>
                  Sacar
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="font-bold text-[15px]">Depositar via Boleto</div>
          <div className="text-[13px] font-mono-num text-textSecondary">Saldo: {data.saldoDisponivelFmt}</div>
        </div>
        {!data.boletoEnabled && (
          <div className="text-[12px] text-textSecondary mb-3">
            Modo simulado — nenhum PSP de boleto real configurado (BOLETO_PSP_*). O depósito precisa ser confirmado manualmente abaixo.
          </div>
        )}
        <div className="flex gap-2 mb-4">
          <input
            value={boletoValor}
            onChange={(e) => setBoletoValor(e.target.value)}
            placeholder="Valor (R$)"
            inputMode="decimal"
            className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
          />
          <Button variant="primary" disabled={busy || !boletoValor} onClick={gerarBoleto}>
            Gerar boleto
          </Button>
        </div>
        {data.boletos
          .filter((b) => b.status === 'ativo')
          .map((b) => (
            <div key={b.nossoNumero} className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-[#F7F8FA] mb-2 text-[12.5px]">
              <div>
                <div className="font-semibold">{b.valorFmt}</div>
                {b.linhaDigitavel ? (
                  <div className="break-all text-[10.5px] text-textSecondary">{b.linhaDigitavel}</div>
                ) : (
                  <div className="text-textSecondary">Aguardando pagamento (simulado)</div>
                )}
              </div>
              {b.simulado && (
                <button
                  type="button"
                  onClick={() => confirmarBoletoSimulado(b.nossoNumero)}
                  className="px-2.5 py-1.5 rounded-md border-none bg-green text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                >
                  Confirmar (simulado)
                </button>
              )}
            </div>
          ))}
      </Card>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-[15px]">Depositar via TED</div>
            <div className="text-[13px] font-mono-num text-textSecondary">Saldo: {data.saldoDisponivelFmt}</div>
          </div>
          <div className="text-[12px] text-textSecondary mb-3">
            {data.tedEnabled
              ? 'Conta virtual dedicada gerada via provedor bancário real — confirmação automática por webhook.'
              : data.tedInstructionsAvailable
              ? 'Transferência para a conta bancária real da Lastro — confirmação manual pelo nosso time após validar o extrato (não é instantânea, diferente de Pix/boleto).'
              : 'Modo simulado — nenhum provedor de TED real configurado (TED_PSP_* ou LASTRO_TED_*). Dados bancários abaixo são fictícios.'}
          </div>
          <div className="flex gap-2 mb-4">
            <input
              value={tedDepositValor}
              onChange={(e) => setTedDepositValor(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
            />
            <Button variant="primary" disabled={busy || !tedDepositValor} onClick={gerarDepositoTed}>
              Gerar instrução
            </Button>
          </div>
          {data.tedDeposits
            .filter((t) => t.status === 'ativo')
            .map((t) => (
              <div key={t.referencia} className="p-2.5 rounded-md bg-[#F7F8FA] mb-2 text-[12.5px]">
                <div className="font-semibold">{t.valorFmt}</div>
                <div className="text-textSecondary">
                  {t.banco} · ag. {t.agencia} · cc {t.conta} — {t.favorecidoNome}
                </div>
                <div className="text-textTertiary text-[11px] mt-1">Ref. {t.referencia} · aguardando confirmação{t.simulado ? ' (simulado)' : ''}</div>
              </div>
            ))}
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Sacar via TED</div>
          {!data.tedContaBancaria ? (
            <div className="flex flex-col gap-2">
              <input
                value={tedContaForm.banco}
                onChange={(e) => setTedContaForm({ ...tedContaForm, banco: e.target.value })}
                placeholder="Banco (nome ou código)"
                className="border border-border rounded-md px-3 py-2 text-[13px]"
              />
              <div className="flex gap-2">
                <input
                  value={tedContaForm.agencia}
                  onChange={(e) => setTedContaForm({ ...tedContaForm, agencia: e.target.value })}
                  placeholder="Agência"
                  className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
                />
                <input
                  value={tedContaForm.conta}
                  onChange={(e) => setTedContaForm({ ...tedContaForm, conta: e.target.value })}
                  placeholder="Conta"
                  className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
                />
                <select
                  value={tedContaForm.tipoConta}
                  onChange={(e) => setTedContaForm({ ...tedContaForm, tipoConta: e.target.value as 'corrente' | 'poupanca' })}
                  className="border border-border rounded-md px-2 py-2 text-[13px]"
                >
                  <option value="corrente">Corrente</option>
                  <option value="poupanca">Poupança</option>
                </select>
              </div>
              <input
                value={tedContaForm.titularNome}
                onChange={(e) => setTedContaForm({ ...tedContaForm, titularNome: e.target.value })}
                placeholder="Nome do titular"
                className="border border-border rounded-md px-3 py-2 text-[13px]"
              />
              <input
                value={tedContaForm.titularCnpj}
                onChange={(e) => setTedContaForm({ ...tedContaForm, titularCnpj: e.target.value })}
                placeholder="CNPJ do titular"
                className="border border-border rounded-md px-3 py-2 text-[13px]"
              />
              <Button
                variant="primary"
                disabled={busy || !tedContaForm.banco.trim() || !tedContaForm.agencia.trim() || !tedContaForm.conta.trim() || !tedContaForm.titularNome.trim() || !tedContaForm.titularCnpj.trim()}
                onClick={saveContaTed}
              >
                Salvar conta bancária
              </Button>
            </div>
          ) : (
            <>
              <div className="text-[12.5px] text-textSecondary mb-3">
                Enviado para {data.tedContaBancaria.banco} ag. {data.tedContaBancaria.agencia} cc {data.tedContaBancaria.conta}
                {!data.tedEnabled && ' (simulado)'}
              </div>
              <div className="flex gap-2">
                <input
                  value={tedWithdrawValor}
                  onChange={(e) => setTedWithdrawValor(e.target.value)}
                  placeholder="Valor (R$)"
                  inputMode="decimal"
                  className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
                />
                <Button variant="primary" disabled={busy || !tedWithdrawValor} onClick={sacarTed}>
                  Sacar
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="font-bold text-[15px]">Depositar via {data.stablecoinAsset}</div>
            <div className="text-[13px] font-mono-num text-textSecondary">Saldo: {data.saldoDisponivelFmt}</div>
          </div>
          <div className="text-[12px] text-textSecondary mb-3">
            {data.stablecoinEnabled
              ? `Endereço de depósito dedicado gerado via custodiante real — confirmação automática por webhook. Rede ${data.stablecoinNetwork}.`
              : data.stablecoinInstructionsAvailable
              ? `Envio para a carteira real da Lastro (rede ${data.stablecoinNetwork}) — confirmação manual pelo nosso time após validar a transação na blockchain (não é instantânea).`
              : `Modo simulado — nenhum provedor real configurado (STABLECOIN_PSP_* ou LASTRO_STABLECOIN_WALLET_ADDRESS). Endereço abaixo é fictício.`}
          </div>
          <div className="flex gap-2 mb-4">
            <input
              value={stablecoinDepositValor}
              onChange={(e) => setStablecoinDepositValor(e.target.value)}
              placeholder="Valor (R$)"
              inputMode="decimal"
              className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
            />
            <Button variant="primary" disabled={busy || !stablecoinDepositValor} onClick={gerarDepositoStablecoin}>
              Gerar endereço
            </Button>
          </div>
          {data.stablecoinDeposits
            .filter((s) => s.status === 'ativo')
            .map((s) => (
              <div key={s.referencia} className="p-2.5 rounded-md bg-[#F7F8FA] mb-2 text-[12.5px]">
                <div className="font-semibold">{s.valorFmt}</div>
                <div className="break-all text-textSecondary">
                  {s.asset} ({s.network}): {s.endereco}
                </div>
                <div className="text-textTertiary text-[11px] mt-1">Ref. {s.referencia} · aguardando confirmação{s.simulado ? ' (simulado)' : ''}</div>
              </div>
            ))}
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Sacar via {data.stablecoinAsset}</div>
          {!data.stablecoinWalletEndereco ? (
            <div className="flex gap-2">
              <input
                value={stablecoinWalletInput}
                onChange={(e) => setStablecoinWalletInput(e.target.value)}
                placeholder={`Endereço da carteira (rede ${data.stablecoinNetwork})`}
                className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
              />
              <Button variant="primary" disabled={busy || !stablecoinWalletInput.trim()} onClick={saveWalletStablecoin}>
                Salvar
              </Button>
            </div>
          ) : (
            <>
              <div className="break-all text-[12.5px] text-textSecondary mb-3">
                Enviado para {data.stablecoinWalletEndereco}
                {!data.stablecoinEnabled && ' (simulado)'}
              </div>
              <div className="flex gap-2">
                <input
                  value={stablecoinWithdrawValor}
                  onChange={(e) => setStablecoinWithdrawValor(e.target.value)}
                  placeholder="Valor (R$)"
                  inputMode="decimal"
                  className="flex-1 border border-border rounded-md px-3 py-2 text-[13px]"
                />
                <Button variant="primary" disabled={busy || !stablecoinWithdrawValor} onClick={sacarStablecoin}>
                  Sacar
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden mb-4">
        <div className="px-5 py-4.5 font-bold text-[15px] border-b border-border">Extrato de liquidação</div>
        {data.extrato.map((e, i) => (
          <div key={i} className="grid gap-3 px-5 py-3.5 border-b border-hairline last:border-b-0 items-center text-[13.5px]" style={{ gridTemplateColumns: '1fr 1.6fr 0.9fr 0.9fr' }}>
            <div className="text-textSecondary font-mono-num text-[12.5px]">{e.data}</div>
            <div>{e.descricao}</div>
            <div className="font-mono-num font-bold" style={{ color: e.isPositive ? '#0A5C36' : '#0B1F3A' }}>
              {e.valorFmt}
            </div>
            <div className="font-mono-num text-textSecondary">{e.saldoFmt}</div>
          </div>
        ))}
      </div>

      <NavyCard className="p-6.5">
        <div className="font-bold text-[15px] mb-2.5">Como a Lastro monetiza</div>
        <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed mb-4.5 max-w-[640px]">
          Cobramos uma taxa de plataforma de 0,35% sobre o valor de cada operação, descontada automaticamente na liquidação — sem mensalidade e sem taxa de adesão.
        </div>
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Valor da operação</div>
            <div className="text-[19px] font-extrabold mt-1.5">R$ 84.500</div>
          </div>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Taxa da plataforma (0,35%)</div>
            <div className="text-[19px] font-extrabold mt-1.5">R$ 295,75</div>
          </div>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="text-[#9FB3D6] text-xs font-semibold">Líquido repassado</div>
            <div className="text-[19px] font-extrabold mt-1.5 text-[#6FCF97]">R$ 84.204,25</div>
          </div>
        </div>
      </NavyCard>
    </div>
  );
}
