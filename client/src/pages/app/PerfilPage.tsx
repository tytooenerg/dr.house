import { useEffect, useState } from 'react';
import { api, downloadFile, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { useSession } from '../../state/SessionContext';

interface ProfileData {
  profileForm: { nome: string; email: string; telefone: string };
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean; digest: boolean; compliance: boolean };
  notifyViaWhatsapp: boolean;
  whatsappEnabled: boolean;
  teamMembers: { id: number; nome: string; email: string; papel: string; status: 'pending' | 'active' | 'revoked' }[];
  inviteUrl?: string;
}

const TEAM_STATUS_LABEL: Record<'pending' | 'active' | 'revoked', { label: string; bg: string; color: string }> = {
  pending: { label: 'Convite pendente', bg: '#FBF1E0', color: '#B8790A' },
  active: { label: 'Ativo', bg: '#EAF3EE', color: '#0A5C36' },
  revoked: { label: 'Revogado', bg: '#F7E9E7', color: '#B3261E' },
};

interface ReferralData {
  code: string;
  link: string;
  bonusEmissoesMensais: number;
  indicados: { nome: string; companyName: string; role: string; createdAt: string }[];
}

interface TwoFactorStatus {
  enabled: boolean;
  remainingRecoveryCodes: number;
}

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

// Real Web Push (server/src/lib/webPush.ts) — VAPID key delivery, permission request,
// service worker registration and pushManager.subscribe() all happen for real in the
// browser; nothing here is simulated client-side (the server-side send is what's
// real-when-configured, not this).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

const NOTIF_ROWS: { key: keyof ProfileData['notifPrefs']; label: string; hint: string }[] = [
  { key: 'leilao', label: 'Leilões em andamento', hint: 'Encerramento e lances concorrentes' },
  { key: 'aceite', label: 'Aceite de duplicatas', hint: 'Quando um sacado confirma ou contesta' },
  { key: 'disputa', label: 'Disputas', hint: 'Contestações e resoluções' },
  { key: 'compliance', label: 'Conformidade — duplicata escritural', hint: 'Lembretes de faturamento não informado e prazos se aproximando' },
  { key: 'marketing', label: 'Novidades e produto', hint: 'Comunicados de marketing' },
];

// Only means anything for an admin account (the back-office's own Resumo diário —
// lib/dailyBriefing.ts) — kept out of NOTIF_ROWS so a cedente/investidor/sacado never
// sees a toggle for an email they could never receive in the first place.
const DIGEST_ROW: { key: keyof ProfileData['notifPrefs']; label: string; hint: string } = {
  key: 'digest',
  label: 'Resumo diário do back-office',
  hint: 'KYB, disputas, compliance e outras filas pendentes, uma vez por dia',
};

export function PerfilPage() {
  const { logout, user } = useSession();
  const [data, setData] = useState<ProfileData | null>(null);
  const [saved, setSaved] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteNome, setInviteNome] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [referral, setReferral] = useState<ReferralData | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  const [twoFactor, setTwoFactor] = useState<TwoFactorStatus | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorError, setTwoFactorError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling2fa, setDisabling2fa] = useState(false);
  const [disable2faPassword, setDisable2faPassword] = useState('');
  const [disable2faError, setDisable2faError] = useState('');
  const [savingTwoFactor, setSavingTwoFactor] = useState(false);
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    api.get<ProfileData>('/profile').then(setData);
    api.get<ReferralData>('/referral').then(setReferral);
    api.get<TwoFactorStatus>('/auth/2fa/status').then(setTwoFactor);
    api.get<PushConfig>('/notifications/push/config').then(setPushConfig);
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.getRegistration().then(async (registration) => {
        const sub = await registration?.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      });
    }
  }, []);

  if (!data) return <PageSkeleton />;

  const setField = async (field: keyof ProfileData['profileForm'], value: string) => {
    const d = await api.post<ProfileData>('/profile/field', { field, value });
    setData(d);
  };

  const toggleNotif = async (key: string) => {
    const d = await api.post<ProfileData>('/profile/notif-pref', { key });
    setData(d);
  };

  const toggleWhatsapp = async () => {
    const d = await api.post<ProfileData>('/profile/notify-whatsapp-toggle');
    setData(d);
  };

  const togglePush = async () => {
    setPushError('');
    if (pushSubscribed) {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      if (sub) {
        await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
      return;
    }
    if (!pushConfig?.enabled || !pushConfig.publicKey) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushError('Permissão de notificação negada pelo navegador.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey),
      });
      const json = sub.toJSON();
      await api.post('/notifications/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
      setPushSubscribed(true);
    } catch (err) {
      setPushError(err instanceof ApiError ? err.message : 'Não foi possível ativar notificações push neste navegador.');
    }
  };

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadFile('/account/export', 'lastro-meus-dados.json');
    } finally {
      setExporting(false);
    }
  };

  const submitDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleting(true);
    setDeleteError('');
    try {
      await api.post('/account/delete', { password: deletePassword });
      logout();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Não foi possível excluir a conta.');
    } finally {
      setDeleting(false);
    }
  };

  const copyReferralLink = () => {
    if (!referral) return;
    navigator.clipboard?.writeText(`${window.location.origin}${referral.link}`).catch(() => {});
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 1500);
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteNome.trim() || !inviteEmail.trim()) return;
    const d = await api.post<ProfileData>('/profile/team/invite', { nome: inviteNome, email: inviteEmail });
    setData(d);
    setLastInviteUrl(d.inviteUrl ?? null);
    setInviteNome('');
    setInviteEmail('');
    setInviting(false);
  };

  const copyInviteLink = () => {
    if (!lastInviteUrl) return;
    navigator.clipboard?.writeText(lastInviteUrl).catch(() => {});
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1500);
  };

  const revokeMember = async (id: number) => {
    const d = await api.post<ProfileData>(`/profile/team/${id}/revoke`);
    setData(d);
  };

  const startTwoFactorSetup = async () => {
    setTwoFactorError('');
    const d = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup');
    setTwoFactorSetup(d);
  };

  const confirmTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTwoFactor(true);
    setTwoFactorError('');
    try {
      const d = await api.post<{ ok: true; recoveryCodes: string[] }>('/auth/2fa/confirm', { code: twoFactorCode.trim() });
      setRecoveryCodes(d.recoveryCodes);
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      setTwoFactor(await api.get<TwoFactorStatus>('/auth/2fa/status'));
    } catch (err) {
      setTwoFactorError(err instanceof ApiError ? err.message : 'Código inválido.');
    } finally {
      setSavingTwoFactor(false);
    }
  };

  const submitDisableTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTwoFactor(true);
    setDisable2faError('');
    try {
      await api.post('/auth/2fa/disable', { password: disable2faPassword });
      setTwoFactor({ enabled: false, remainingRecoveryCodes: 0 });
      setDisabling2fa(false);
      setDisable2faPassword('');
    } catch (err) {
      setDisable2faError(err instanceof ApiError ? err.message : 'Não foi possível desativar.');
    } finally {
      setSavingTwoFactor(false);
    }
  };

  return (
    <div>
      <PageHeader title="Perfil & Configurações" subtitle="Dados da conta, equipe e preferências de notificação" />

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-4">Dados da conta</div>
          <div className="flex flex-col gap-3.5">
            <Field label="Nome">
              <Input value={data.profileForm.nome} onChange={(e) => setField('nome', e.target.value)} />
            </Field>
            <Field label="E-mail">
              <Input value={data.profileForm.email} onChange={(e) => setField('email', e.target.value)} />
            </Field>
            <Field label="Telefone">
              <Input value={data.profileForm.telefone} onChange={(e) => setField('telefone', e.target.value)} />
            </Field>
            <Button className="self-start mt-1" onClick={save}>
              {saved ? 'Salvo ✓' : 'Salvar dados da conta'}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="font-bold text-[15px] mb-4">Preferências de notificação</div>
          <div className="flex flex-col gap-4">
            {(user?.role === 'admin' ? [...NOTIF_ROWS, DIGEST_ROW] : NOTIF_ROWS).map((row) => (
              <div key={row.key} className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[13.5px]">{row.label}</div>
                  <div className="text-textTertiary text-xs mt-0.5">{row.hint}</div>
                </div>
                <Toggle on={data.notifPrefs[row.key]} onClick={() => toggleNotif(row.key)} />
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t border-hairline">
              <div>
                <div className="font-semibold text-[13.5px]">Também via WhatsApp</div>
                <div className="text-textTertiary text-xs mt-0.5">
                  {data.whatsappEnabled ? 'Envia as mesmas notificações para o telefone cadastrado' : 'Modo simulado — nenhum TWILIO_* configurado no servidor'}
                </div>
              </div>
              <Toggle on={data.notifyViaWhatsapp} onClick={toggleWhatsapp} />
            </div>
            {pushConfig?.enabled && 'serviceWorker' in navigator && 'PushManager' in window && (
              <div className="flex items-center justify-between pt-2 border-t border-hairline">
                <div>
                  <div className="font-semibold text-[13.5px]">Notificações push no navegador</div>
                  <div className="text-textTertiary text-xs mt-0.5">Alertas reais direto no seu navegador ou desktop, mesmo com a aba fechada</div>
                  {pushError && <div className="text-red text-xs mt-1 font-semibold">{pushError}</div>}
                </div>
                <Toggle on={pushSubscribed} onClick={togglePush} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="font-bold text-[15px] mb-3.5">Prévia de como as notificações chegam</div>
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="border border-border rounded-[10px] overflow-hidden">
            <div className="px-3.5 py-2.5 bg-bg text-[11.5px] font-bold text-textSecondary">E-MAIL</div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-[26px] h-[26px] rounded-md bg-blue flex items-center justify-center font-extrabold text-white text-xs">L</div>
                <div className="font-bold text-[13px]">Lastro</div>
              </div>
              <div className="font-bold text-[13.5px] mb-1">Novo lance no leilão DUP-2026-0842</div>
              <div className="text-textSecondary text-[12.5px] leading-snug">Um financiador ofereceu 1,7% a.m. pela sua duplicata do Grupo Atlas Varejo. Restam 2h para o encerramento.</div>
            </div>
          </div>
          <div className="border border-border rounded-[10px] overflow-hidden">
            <div className="px-3.5 py-2.5 bg-bg text-[11.5px] font-bold text-textSecondary">PUSH</div>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-[22px] h-[22px] rounded-md bg-navy flex items-center justify-center font-extrabold text-white text-[11px]">L</div>
                <div className="font-bold text-[12.5px]">Lastro · agora</div>
              </div>
              <div className="text-[13px] font-semibold">Sacado confirmou a duplicata DUP-2026-0917 ✓</div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="font-bold text-[15px]">Verificação em duas etapas (2FA)</div>
          {twoFactor && (
            <span
              className="text-[11.5px] font-bold px-2.5 py-1 rounded-md"
              style={twoFactor.enabled ? { background: '#EAF3EE', color: '#0A5C36' } : { background: '#F0F2F5', color: '#5B6472' }}
            >
              {twoFactor.enabled ? 'Ativada' : 'Desativada'}
            </span>
          )}
        </div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">Exige um código do seu app autenticador (Google Authenticator, Authy, 1Password…) além da senha para entrar.</div>

        {twoFactor?.enabled && !disabling2fa && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[12.5px] text-textSecondary">{twoFactor.remainingRecoveryCodes} código(s) de recuperação restantes.</span>
            <Button size="sm" variant="secondary" onClick={() => setDisabling2fa(true)}>
              Desativar 2FA
            </Button>
          </div>
        )}

        {twoFactor?.enabled && disabling2fa && (
          <form onSubmit={submitDisableTwoFactor} className="flex items-end gap-2.5 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Field label="Confirme sua senha para desativar">
                <Input type="password" value={disable2faPassword} onChange={(e) => setDisable2faPassword(e.target.value)} placeholder="Sua senha" />
              </Field>
            </div>
            <Button type="submit" size="sm" variant="danger" disabled={savingTwoFactor || !disable2faPassword}>
              {savingTwoFactor ? 'Desativando…' : 'Confirmar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDisabling2fa(false); setDisable2faPassword(''); setDisable2faError(''); }}>
              Cancelar
            </Button>
            {disable2faError && <div className="w-full text-red text-[12px] font-semibold">{disable2faError}</div>}
          </form>
        )}

        {twoFactor && !twoFactor.enabled && !twoFactorSetup && !recoveryCodes && (
          <Button size="sm" onClick={startTwoFactorSetup}>
            Ativar 2FA
          </Button>
        )}

        {twoFactorSetup && (
          <form onSubmit={confirmTwoFactor} className="flex flex-col gap-2.5 p-4 rounded-lg bg-[#F7F8FA]">
            <div className="text-[12.5px] text-textSecondary">
              Adicione esta chave manualmente no seu app autenticador (issuer <b>Lastro</b>, conta {data.profileForm.email}, SHA1, 6 dígitos, 30s):
            </div>
            <div className="font-mono-num text-[13px] font-bold bg-white border border-border rounded-md px-3 py-2 break-all">{twoFactorSetup.secret}</div>
            <div className="flex items-end gap-2.5 flex-wrap mt-1">
              <div className="flex-1 min-w-[160px]">
                <Field label="Código do app">
                  <Input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6} />
                </Field>
              </div>
              <Button type="submit" size="sm" disabled={savingTwoFactor || twoFactorCode.trim().length !== 6}>
                {savingTwoFactor ? 'Confirmando…' : 'Confirmar e ativar'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setTwoFactorSetup(null); setTwoFactorCode(''); setTwoFactorError(''); }}>
                Cancelar
              </Button>
            </div>
            {twoFactorError && <div className="text-red text-[12px] font-semibold">{twoFactorError}</div>}
          </form>
        )}

        {recoveryCodes && (
          <div className="flex flex-col gap-2.5 p-4 rounded-lg bg-[#F7F8FA]">
            <div className="font-bold text-[13px] text-navy">2FA ativada — guarde estes códigos de recuperação</div>
            <div className="text-[12px] text-textSecondary">Cada um só pode ser usado uma vez, caso você perca acesso ao seu app autenticador. Eles não serão mostrados novamente.</div>
            <div className="grid gap-1.5 font-mono-num text-[13px] font-bold" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {recoveryCodes.map((c) => (
                <div key={c} className="bg-white border border-border rounded-md px-3 py-1.5 text-center">{c}</div>
              ))}
            </div>
            <Button size="sm" className="self-start" onClick={() => setRecoveryCodes(null)}>
              Entendi, guardei os códigos
            </Button>
          </div>
        )}
      </Card>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4.5 border-b border-border">
          <div className="font-bold text-[15px]">Equipe</div>
          <button type="button" onClick={() => setInviting((v) => !v)} className="px-3.5 py-2 rounded-lg border border-inputBorder bg-white text-navy text-[12.5px] font-bold cursor-pointer">
            {inviting ? 'Cancelar' : 'Convidar membro'}
          </button>
        </div>
        {inviting && (
          <form onSubmit={submitInvite} className="flex items-end gap-2.5 px-5 py-3.5 border-b border-hairline bg-[#F7F8FA]">
            <div className="flex-1">
              <Field label="Nome">
                <Input value={inviteNome} onChange={(e) => setInviteNome(e.target.value)} placeholder="Nome do convidado" />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="E-mail">
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@empresa.com.br" />
              </Field>
            </div>
            <Button type="submit" size="sm">
              Enviar convite
            </Button>
          </form>
        )}
        {lastInviteUrl && (
          <div className="flex items-center justify-between gap-2.5 px-5 py-3 border-b border-hairline bg-[#EEF3FF] text-[12.5px]">
            <div className="truncate">
              Convite criado — se o e-mail não chegar, envie este link diretamente: <span className="font-mono-num text-navy">{lastInviteUrl}</span>
            </div>
            <Button size="sm" variant="secondary" onClick={copyInviteLink}>
              {copiedInvite ? 'Copiado!' : 'Copiar link'}
            </Button>
          </div>
        )}
        {data.teamMembers.map((m) => {
          const meta = TEAM_STATUS_LABEL[m.status];
          return (
            <div key={m.id} className="flex items-center justify-between px-5 py-3.5 border-b border-hairline last:border-b-0">
              <div>
                <div className="font-semibold text-[13.5px]">{m.nome}</div>
                <div className="text-textTertiary text-xs mt-0.5">{m.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-bg text-textSecondary">{m.papel}</span>
                <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: meta.bg, color: meta.color }}>
                  {meta.label}
                </span>
                {m.status !== 'revoked' && (
                  <button
                    type="button"
                    onClick={() => revokeMember(m.id)}
                    className="text-[11.5px] font-bold px-2.5 py-1 rounded-md border border-red text-red bg-white cursor-pointer"
                  >
                    Revogar
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {data.teamMembers.length === 0 && (
          <div className="px-5 py-6 text-center text-textTertiary text-[12.5px]">Nenhum membro convidado ainda.</div>
        )}
      </div>

      {referral && (
        <Card className="mt-4">
          <div className="font-bold text-[15px] mb-1">Indique e ganhe</div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            Cada empresa que se cadastrar com seu link ganha você +1 emissão mensal extra no plano Básico.
            {referral.bonusEmissoesMensais > 0 && <span className="font-bold text-green"> Você já tem +{referral.bonusEmissoesMensais} de bônus.</span>}
          </div>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex-1 bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5 font-mono-num text-[13px] truncate">
              {window.location.origin}
              {referral.link}
            </div>
            <Button size="sm" variant="secondary" onClick={copyReferralLink}>
              {copiedRef ? 'Copiado!' : 'Copiar link'}
            </Button>
          </div>
          {referral.indicados.length > 0 && (
            <div className="flex flex-col gap-2">
              {referral.indicados.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold">{r.companyName}</span>
                  <span className="text-textTertiary">{r.role}</span>
                </div>
              ))}
            </div>
          )}
          {referral.indicados.length === 0 && <div className="text-textTertiary text-[12px]">Ninguém se cadastrou com seu link ainda.</div>}
        </Card>
      )}

      <Card className="mt-4">
        <div className="font-bold text-[15px] mb-1">Privacidade e dados (LGPD)</div>
        <div className="text-textSecondary text-[12.5px] mb-4">Exporte uma cópia de tudo que a Lastro guarda sobre sua conta, ou solicite a exclusão dos seus dados pessoais.</div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button size="sm" variant="secondary" disabled={exporting} onClick={exportData}>
            {exporting ? 'Exportando…' : 'Exportar meus dados'}
          </Button>
          <button
            type="button"
            onClick={() => setDeleteConfirmOpen((v) => !v)}
            className="px-3.5 py-2 rounded-lg border border-red text-red bg-white text-[12.5px] font-bold cursor-pointer"
          >
            {deleteConfirmOpen ? 'Cancelar' : 'Excluir minha conta'}
          </button>
        </div>
        {deleteConfirmOpen && (
          <form onSubmit={submitDelete} className="mt-3.5 p-3.5 rounded-lg bg-[#F7E9E7] flex flex-col gap-2.5">
            <div className="text-[12.5px] text-[#8A3A2E]">
              Isso apaga seus dados pessoais (nome, e-mail, telefone) e revoga todas as sessões, chaves de API e webhooks. Registros financeiros são
              mantidos de forma anonimizada, conforme obrigação legal. Confirme sua senha para continuar.
            </div>
            <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Sua senha" />
            {deleteError && <div className="text-red text-[12px] font-semibold">{deleteError}</div>}
            <Button type="submit" variant="danger" disabled={deleting || !deletePassword} className="self-start">
              {deleting ? 'Excluindo…' : 'Confirmar exclusão definitiva'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
