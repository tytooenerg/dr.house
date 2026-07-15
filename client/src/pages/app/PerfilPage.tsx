import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';

interface ProfileData {
  profileForm: { nome: string; email: string; telefone: string };
  notifPrefs: { leilao: boolean; aceite: boolean; disputa: boolean; marketing: boolean };
  teamMembers: { nome: string; email: string; papel: string }[];
}

const NOTIF_ROWS: { key: keyof ProfileData['notifPrefs']; label: string; hint: string }[] = [
  { key: 'leilao', label: 'Leilões em andamento', hint: 'Encerramento e lances concorrentes' },
  { key: 'aceite', label: 'Aceite de duplicatas', hint: 'Quando um sacado confirma ou contesta' },
  { key: 'disputa', label: 'Disputas', hint: 'Contestações e resoluções' },
  { key: 'marketing', label: 'Novidades e produto', hint: 'Comunicados de marketing' },
];

export function PerfilPage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [saved, setSaved] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteNome, setInviteNome] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => {
    api.get<ProfileData>('/profile').then(setData);
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

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteNome.trim() || !inviteEmail.trim()) return;
    const d = await api.post<ProfileData>('/profile/team/invite', { nome: inviteNome, email: inviteEmail });
    setData(d);
    setInviteNome('');
    setInviteEmail('');
    setInviting(false);
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
            {NOTIF_ROWS.map((row) => (
              <div key={row.key} className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[13.5px]">{row.label}</div>
                  <div className="text-textTertiary text-xs mt-0.5">{row.hint}</div>
                </div>
                <Toggle on={data.notifPrefs[row.key]} onClick={() => toggleNotif(row.key)} />
              </div>
            ))}
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
        {data.teamMembers.map((m) => (
          <div key={m.email} className="flex items-center justify-between px-5 py-3.5 border-b border-hairline last:border-b-0">
            <div>
              <div className="font-semibold text-[13.5px]">{m.nome}</div>
              <div className="text-textTertiary text-xs mt-0.5">{m.email}</div>
            </div>
            <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-bg text-textSecondary">{m.papel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
