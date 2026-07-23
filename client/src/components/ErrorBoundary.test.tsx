import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('falha simulada na tela');
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>conteúdo normal</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('conteúdo normal')).toBeInTheDocument();
  });

  it('catches a render error and shows a fallback with the error message', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Algo deu errado nesta tela')).toBeInTheDocument();
    expect(screen.getByText('falha simulada na tela')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('lets the user retry, re-rendering children after reset', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('erro temporário');
      return <div>recuperado</div>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('Algo deu errado nesta tela')).toBeInTheDocument();
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(screen.getByText('recuperado')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
