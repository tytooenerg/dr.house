import { useLang } from '../lib/i18n';

export function LanguageToggle({ className, dark }: { className?: string; dark?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
      className={`bg-transparent border-none cursor-pointer text-[11.5px] font-bold ${className ?? ''}`}
      style={{ color: dark ? '#8B97AC' : undefined }}
      aria-label="Trocar idioma / Switch language"
      title={lang === 'pt' ? 'Switch to English' : 'Mudar para Português'}
    >
      {lang === 'pt' ? 'EN' : 'PT'}
    </button>
  );
}
