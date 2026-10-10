import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BackupsPanel } from './BackupsPanel';

// A linha "Cópia fora do servidor" é o único lugar onde o admin descobre que os backups estão
// (ou não) a salvo de uma perda do servidor. Cada estado tem que dizer a verdade: nada de
// verde quando o último envio falhou depois do último sucesso.

const OFFSITE_BASE = {
  configurado: true,
  destino: 's3.us-west-004.backblazeb2.com/lastro-backups' as string | null,
  ultimoEnvioEm: null as string | null,
  ultimoEnvioQuando: null as string | null,
  ultimoErro: null as string | null,
  ultimoErroEm: null as string | null,
  ultimoErroQuando: null as string | null,
  documentosEnviados: 0,
  documentosPendentes: 0,
};

function renderPanel(offsite: typeof OFFSITE_BASE) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = String(url).includes('/admin/backups')
        ? { enabled: true, backups: [], offsite }
        : { totalBytes: 0, fileCount: 0, missingCount: 0, byKind: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    })
  );
  return render(<BackupsPanel />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BackupsPanel — cópia fora do servidor', () => {
  it('não configurada: avisa que tudo está só no disco do servidor', async () => {
    renderPanel({ ...OFFSITE_BASE, configurado: false, destino: null });
    expect(await screen.findByText('Cópia fora do servidor: não configurada')).toBeInTheDocument();
    expect(screen.getByText(/ficam só no disco do servidor/)).toBeInTheDocument();
  });

  it('ativa: mostra quando foi o último envio, para onde e quantos documentos', async () => {
    renderPanel({ ...OFFSITE_BASE, ultimoEnvioEm: '2026-10-10T01:00:00.000Z', ultimoEnvioQuando: 'há 2 h', documentosEnviados: 297, documentosPendentes: 3 });
    expect(await screen.findByText('Cópia fora do servidor: ativa')).toBeInTheDocument();
    expect(screen.getByText(/último envio há 2 h para s3\.us-west-004\.backblazeb2\.com\/lastro-backups \(297 documento\(s\) copiados, 3 aguardando/)).toBeInTheDocument();
  });

  it('erro depois do último sucesso: vermelho com a mensagem, nunca verde', async () => {
    renderPanel({
      ...OFFSITE_BASE,
      ultimoEnvioEm: '2026-10-09T01:00:00.000Z',
      ultimoEnvioQuando: 'há 1 dia',
      ultimoErro: 'armazenamento respondeu HTTP 403 AccessDenied',
      ultimoErroEm: '2026-10-10T01:00:00.000Z',
      ultimoErroQuando: 'há 2 h',
    });
    expect(await screen.findByText('Cópia fora do servidor: falhou há 2 h')).toBeInTheDocument();
    expect(screen.getByText(/armazenamento respondeu HTTP 403 AccessDenied/)).toBeInTheDocument();
    expect(screen.queryByText('Cópia fora do servidor: ativa')).not.toBeInTheDocument();
  });

  it('configurada mas nunca enviada: orienta a testar com o botão', async () => {
    renderPanel(OFFSITE_BASE);
    expect(await screen.findByText('Cópia fora do servidor: configurada')).toBeInTheDocument();
    expect(screen.getByText(/Rodar backup agora/, { selector: 'span' })).toBeInTheDocument();
  });
});
