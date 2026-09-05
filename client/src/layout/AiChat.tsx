import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AiTag } from '../components/ui/Badge';
import { PALETTE } from '../lib/palette';

interface Message {
  from: 'bot' | 'user';
  text: string;
}

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { from: 'bot', text: 'Oi! Posso ajudar a entender deságio, aceite, ou como emitir sua primeira duplicata. O que você quer saber?' },
  ]);
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ suggestions: string[] }>('/chat').then((d) => setSuggestions(d.suggestions));
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

  const ask = async (question: string) => {
    setMessages((m) => [...m, { from: 'user', text: question }]);
    setAsking(true);
    const res = await api.post<{ answer: string }>('/chat/ask', { question });
    setMessages((m) => [...m, { from: 'bot', text: res.answer }]);
    setAsking(false);
  };

  return (
    <div className="fixed bottom-7 right-8 z-[60]" ref={ref}>
      {open && (
        <div role="dialog" aria-label="Assistente Lastro" className="w-80 bg-white border border-border rounded-2xl shadow-modal overflow-hidden mb-3">
          <div className="bg-navy px-4 py-3.5 flex items-center gap-2">
            <AiTag />
            <div className="text-white font-bold text-[13px]">Assistente Lastro</div>
          </div>
          <div className="p-4 flex flex-col gap-3 max-h-72 overflow-y-auto" aria-live="polite">
            {messages.map((m, i) => (
              <div
                key={i}
                className="rounded-[10px] px-3 py-2.5 text-[12.5px] leading-snug"
                style={m.from === 'bot' ? { background: PALETTE.surface } : { background: PALETTE.chip, alignSelf: 'flex-end' }}
              >
                {m.text}
              </div>
            ))}
            {asking && <div className="text-textMuted text-[12.5px]">Digitando…</div>}
            {!asking &&
              suggestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => ask(q)}
                  className="border border-border rounded-lg px-3 py-2 text-[12.5px] cursor-pointer text-blue font-semibold text-left bg-white"
                >
                  {q}
                </button>
              ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Assistente de IA"
        className="w-[52px] h-[52px] rounded-full border-none bg-blue shadow-fab cursor-pointer flex items-center justify-center"
      >
        <span className="text-[10.5px] font-extrabold text-white" aria-hidden="true">
          IA
        </span>
      </button>
    </div>
  );
}
