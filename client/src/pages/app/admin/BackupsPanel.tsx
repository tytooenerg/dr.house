import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  quando: string;
}

interface OffsiteStatus {
  configurado: boolean;
  destino: string | null;
  ultimoEnvioEm: string | null;
  ultimoEnvioQuando: string | null;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  ultimoErroQuando: string | null;
  documentosEnviados: number;
  documentosPendentes: number;
}

interface UploadsDiskUsage {
  totalBytes: number;
  fileCount: number;
  missingCount: number;
  byKind: { kind: string; count: number; bytes: number }[];
}

function fmtMB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function BackupsPanel() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsEnabled, setBackupsEnabled] = useState(true);
  const [runningBackup, setRunningBackup] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diskUsage, setDiskUsage] = useState<UploadsDiskUsage | null>(null);
  const [offsite, setOffsite] = useState<OffsiteStatus | null>(null);

  const loadBackups = () => {
    setLoadError(null);
    return api
      .get<{ enabled: boolean; backups: BackupInfo[]; offsite: OffsiteStatus }>('/admin/backups')
      .then((d) => {
        setBackupsEnabled(d.enabled);
        setBackups(d.backups);
        setOffsite(d.offsite);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar os backups.'));
  };

  useEffect(() => {
    loadBackups();
    api.get<UploadsDiskUsage>('/admin/uploads/disk-usage').then(setDiskUsage).catch(() => {});
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadBackups} />;

  const runBackupNow = async () => {
    setRunningBackup(true);
    try {
      await api.post('/admin/backups/run');
      await loadBackups();
    } catch {
      // surfaced via the list simply not gaining a new entry
    } finally {
      setRunningBackup(false);
    }
  };

  return (
    <>
    <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div>
          <div className="font-bold text-[14px]">Backups do banco de dados</div>
          <div className="text-[12.5px] text-textMuted mt-0.5">Snapshots automáticos a cada 6h, retenção configurável (padrão: últimos 28)</div>
        </div>
        <Button onClick={runBackupNow} disabled={runningBackup || !backupsEnabled} variant="secondary">
          {runningBackup ? 'Gerando…' : 'Rodar backup agora'}
        </Button>
      </div>
      {offsite && <OffsiteLine offsite={offsite} />}
      {!backupsEnabled && (
        <div className="px-5 py-3.5 text-[13px] text-textMuted">Desabilitado neste ambiente (banco em memória — não há arquivo em disco para copiar).</div>
      )}
      {backupsEnabled &&
        backups.map((b) => (
          <div key={b.filename} className="px-5 py-3 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
            <div className="font-mono-num text-[12.5px]">{b.filename}</div>
            <div className="flex items-center gap-3 text-textMuted">
              <span>{(b.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
              <span>{b.quando}</span>
            </div>
          </div>
        ))}
      {backupsEnabled && backups.length === 0 && <EmptyState title="Nenhum backup gerado ainda" hint="O primeiro roda automaticamente ao iniciar o servidor" />}
    </div>

    <div className="bg-white border border-border rounded-card overflow-hidden mt-5">
      <div className="px-5 py-3.5 border-b border-border">
        <div className="font-bold text-[14px]">Uso de disco — documentos enviados</div>
        <div className="text-[12.5px] text-textMuted mt-0.5">
          Comprovantes, contratos e documentos de KYB nunca são apagados (retenção de compliance) — acompanhe aqui antes que o espaço acabe
        </div>
      </div>
      {diskUsage && (
        <>
          <div className="px-5 py-3 border-b border-bg flex items-center justify-between gap-3 text-[13px]">
            <span className="font-semibold">Total</span>
            <div className="flex items-center gap-3 text-textMuted">
              <span className="font-mono-num">{fmtMB(diskUsage.totalBytes)}</span>
              <span>{diskUsage.fileCount} arquivo(s)</span>
              {diskUsage.missingCount > 0 && <span className="text-red">{diskUsage.missingCount} registrado(s) sem arquivo em disco</span>}
            </div>
          </div>
          {diskUsage.byKind.map((k) => (
            <div key={k.kind} className="px-5 py-2.5 border-b border-bg last:border-b-0 flex items-center justify-between gap-3 text-[12.5px]">
              <span className="font-mono-num text-textSecondary">{k.kind}</span>
              <div className="flex items-center gap-3 text-textMuted">
                <span className="font-mono-num">{fmtMB(k.bytes)}</span>
                <span>{k.count} arquivo(s)</span>
              </div>
            </div>
          ))}
          {diskUsage.fileCount === 0 && <EmptyState title="Nenhum arquivo enviado ainda" hint="Comprovantes, contratos e documentos de KYB aparecem aqui conforme são enviados" />}
        </>
      )}
    </div>
    </>
  );
}

function OffsiteLine({ offsite }: { offsite: OffsiteStatus }) {
  if (!offsite.configurado) {
    return (
      <div className="px-5 py-3 border-b border-border bg-amberBg text-[13px]" data-testid="offsite-status">
        <span className="font-semibold text-amber">Cópia fora do servidor: não configurada</span>
        <span className="text-textMuted"> — os backups e os documentos enviados ficam só no disco do servidor. Ver DEPLOY.md, "Backup fora do servidor".</span>
      </div>
    );
  }
  // Erro mais novo que o último envio bem-sucedido: a cópia está parada.
  if (offsite.ultimoErro && (!offsite.ultimoEnvioEm || (offsite.ultimoErroEm ?? '') > offsite.ultimoEnvioEm)) {
    return (
      <div className="px-5 py-3 border-b border-border bg-redBg text-[13px]" data-testid="offsite-status">
        <span className="font-semibold text-red">Cópia fora do servidor: falhou{offsite.ultimoErroQuando ? ` ${offsite.ultimoErroQuando}` : ''}</span>
        <span className="text-textMuted"> — {offsite.ultimoErro} ({offsite.destino})</span>
      </div>
    );
  }
  if (!offsite.ultimoEnvioEm) {
    return (
      <div className="px-5 py-3 border-b border-border text-[13px]" data-testid="offsite-status">
        <span className="font-semibold">Cópia fora do servidor: configurada</span>
        <span className="text-textMuted"> — nenhum envio ainda para {offsite.destino}. Clique em "Rodar backup agora" para testar.</span>
      </div>
    );
  }
  return (
    <div className="px-5 py-3 border-b border-border bg-greenBg text-[13px]" data-testid="offsite-status">
      <span className="font-semibold text-green">Cópia fora do servidor: ativa</span>
      <span className="text-textMuted">
        {' '}
        — último envio {offsite.ultimoEnvioQuando} para {offsite.destino} ({offsite.documentosEnviados} documento(s) copiados
        {offsite.documentosPendentes > 0 ? `, ${offsite.documentosPendentes} aguardando o próximo envio` : ''})
      </span>
    </div>
  );
}
