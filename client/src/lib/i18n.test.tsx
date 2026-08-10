import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLang } from './i18n';
import { LanguageToggle } from '../components/LanguageToggle';

function Probe() {
  const { lang, t } = useLang();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="known">{t('nav.developers', 'Desenvolvedores')}</span>
      <span data-testid="unknown">{t('some.key.never.translated', 'Valor padrão em PT')}</span>
    </div>
  );
}

describe('i18n', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to Portuguese and returns the caller-supplied PT string', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('pt');
    expect(screen.getByTestId('known').textContent).toBe('Desenvolvedores');
  });

  it('switches to a real English translation for a covered key when toggled', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe />
        <LanguageToggle />
      </LanguageProvider>
    );
    await user.click(screen.getByRole('button', { name: /trocar idioma/i }));
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('known').textContent).toBe('Developers');
  });

  it('falls back to the PT default for a key with no English translation yet, instead of rendering the raw key', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe />
        <LanguageToggle />
      </LanguageProvider>
    );
    await user.click(screen.getByRole('button', { name: /trocar idioma/i }));
    expect(screen.getByTestId('unknown').textContent).toBe('Valor padrão em PT');
  });

  it('persists the chosen language across a remount (localStorage)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LanguageProvider>
        <Probe />
        <LanguageToggle />
      </LanguageProvider>
    );
    await user.click(screen.getByRole('button', { name: /trocar idioma/i }));
    expect(screen.getByTestId('lang').textContent).toBe('en');
    unmount();

    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('en');
  });
});
