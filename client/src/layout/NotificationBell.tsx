import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../lib/api';
import { Dot } from '../components/ui/Badge';

interface Notification {
  text: string;
  time: string;
  color: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ notifications: Notification[]; unread: boolean }>('/notifications').then((d) => {
      setNotifications(d.notifications);
      setUnread(d.unread);
    });
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && unread) {
      api.post('/notifications/read').then(() => setUnread(false));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Notificações"
        className="w-[38px] h-[38px] rounded-[10px] border border-border bg-white cursor-pointer flex items-center justify-center relative"
        style={{ boxShadow: '0 2px 6px rgba(11,31,58,0.06)' }}
      >
        <Bell size={17} strokeWidth={1.75} className="text-navy" aria-hidden="true" />
        {unread && <span className="absolute rounded-full bg-red border-[1.5px] border-white" style={{ top: 7, right: 8, width: 8, height: 8 }} />}
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 w-80 bg-white border border-border rounded-xl shadow-dropdown overflow-hidden">
          <div className="px-4 py-3.5 font-bold text-[13.5px] border-b border-hairline">Notificações</div>
          {notifications.map((n, i) => (
            <div key={i} className="flex gap-2.5 px-4 py-3 border-b border-surface last:border-b-0">
              <Dot color={n.color} className="mt-1.5" />
              <div>
                <div className="text-[12.5px] leading-snug">{n.text}</div>
                <div className="text-[11px] text-textMuted mt-0.5">{n.time}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
