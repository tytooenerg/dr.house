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
      <span data-testid="dashboard-title">{t('dashboard.title', 'Visão Geral')}</span>
      <span data-testid="marketplace-buy-tokens">{t('marketplace.buyTokens', 'Comprar tokens')}</span>
      <span data-testid="minhas-title">{t('minhas.title', 'Minhas Duplicatas')}</span>
      <span data-testid="historico-title">{t('historico.title', 'Carteira & Histórico')}</span>
      <span data-testid="emitir-title">{t('emitir.title', 'Emitir Duplicata')}</span>
      <span data-testid="admin-title">{t('admin.title', 'Back-office')}</span>
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

  it('translates the Dashboard and Marketplace page chrome keys added beyond nav/footer', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe />
        <LanguageToggle />
      </LanguageProvider>
    );
    expect(screen.getByTestId('dashboard-title').textContent).toBe('Visão Geral');
    expect(screen.getByTestId('marketplace-buy-tokens').textContent).toBe('Comprar tokens');
    await user.click(screen.getByRole('button', { name: /trocar idioma/i }));
    expect(screen.getByTestId('dashboard-title').textContent).toBe('Overview');
    expect(screen.getByTestId('marketplace-buy-tokens').textContent).toBe('Buy tokens');
    expect(screen.getByTestId('minhas-title').textContent).toBe('My Receivables');
    expect(screen.getByTestId('historico-title').textContent).toBe('Portfolio & History');
    expect(screen.getByTestId('emitir-title').textContent).toBe('Issue Receivable');
    expect(screen.getByTestId('admin-title').textContent).toBe('Back Office');
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
