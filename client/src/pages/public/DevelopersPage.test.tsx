import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../lib/i18n';
import { DevelopersPage } from './DevelopersPage';

// Achado corrigido (auditoria de conformidade): esta página afirmava "sete registradoras
// homologadas pelo Banco Central" e nomeava "TAG", "CRDC" e "Quicksoft" — nomes nunca
// confirmados como registradoras reais de duplicata escritural, junto de uma contagem
// exata não verificável. server/src/lib/registradoras.ts só modela 4 (CERC, B3, Núclea,
// Grafeno/SPC) — este teste prova que a página pública não inventa mais nomes nem afirma
// uma contagem que o próprio código não sustenta.

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DevelopersPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('DevelopersPage — contagem de registradoras alinhada com o que o código modela', () => {
  it('não afirma "sete registradoras" nem nomeia registradoras fictícias', () => {
    renderPage();
    expect(screen.queryByText(/sete\s+registradoras/i)).not.toBeInTheDocument();
    for (const nomeFicticio of ['TAG', 'CRDC', 'Quicksoft']) {
      expect(screen.queryByText(nomeFicticio)).not.toBeInTheDocument();
    }
  });

  it('exibe exatamente as 4 registradoras reais modeladas pelo backend', () => {
    renderPage();
    for (const nomeReal of ['CERC', 'B3', 'Núclea']) {
      expect(screen.getByText(nomeReal)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Grafeno/).length).toBeGreaterThan(0);
  });
});
