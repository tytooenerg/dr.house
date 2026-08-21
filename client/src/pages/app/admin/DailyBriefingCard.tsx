import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

interface DailyBriefingItem {
  label: string;
  count: number;
  severity: 'critico' | 'atencao' | 'info';
}
interface DailyBriefing {
  items: DailyBriefingItem[];
  totalPendente: number;
  geradoEm: string;
}

const SEVERITY_COLOR: Record<DailyBriefingItem['severity'], string> = {
  critico: '#B3261E',
  atencao: '#B8790A',
  info: '#5B6472',
};

// Maps a briefing item's label to the tab it's about, so clicking it jumps straight there
// instead of just telling you where to go. lib/dailyBriefing.ts (server) is the source of
// truth for which items can appear — this only needs to know where each one lives in the
// back-office's own tabs.
function tabFor(label: string): string | null {
  if (label.includes('PLD')) return 'compliance';
  if (label.includes('fundo de garantia')) return 'compliance';
  if (label.includes('compliance')) return 'compliance';
  if (label.includes('Disputas')) return 'disputas';
  if (label.includes('KYB')) return 'kyb';
  if (label.includes('reconciliação')) return 'reconciliacao';
  if (label.includes('TED')) return 'auditoria';
  return null;
}

// A one-glance summary of every admin queue that needs attention today, so a fresh login
// doesn't require opening all 9 tabs to find out where time should go. Purely informational
// — it never decides or acts on anything, same read-only relationship every other part of
// this back-office has with lib/dailyBriefing.ts's own email/notification version of this.
export function DailyBriefingCard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);

  useEffect(() => {
    api.get<DailyBriefing>('/admin/daily-briefing').then(setBriefing);
  }, []);

  if (!briefing || briefing.items.length === 0) return null;

  return (
    <div className="bg-white border border-border rounded-card px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
      <span className="text-[11.5px] font-bold text-textTertiary uppercase whitespace-nowrap">Hoje precisa de você</span>
      {briefing.items.map((item) => {
        const tab = tabFor(item.label);
        const chip = (
          <span
            className="text-[12px] font-bold px-2.5 py-1 rounded-md whitespace-nowrap"
            style={{ background: `${SEVERITY_COLOR[item.severity]}18`, color: SEVERITY_COLOR[item.severity] }}
          >
            {item.count} {item.label.toLowerCase()}
          </span>
        );
        return tab ? (
          <button key={item.label} type="button" onClick={() => onNavigate(tab)} className="border-none bg-transparent cursor-pointer p-0">
            {chip}
          </button>
        ) : (
          <span key={item.label}>{chip}</span>
        );
      })}
    </div>
  );
}
