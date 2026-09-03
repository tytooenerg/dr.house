import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

interface MlScoringStatus {
  minTrainingSamples: number;
  minNeuralNetSamples: number;
  model: {
    kind: 'logistic' | 'mlp';
    nSamples: number;
    nPositive: number;
    trainAccuracy: number;
    trainedAt: string;
    featureNames: string[];
    weights: number[] | null;
    featureImportance: { name: string; importance: number }[] | null;
  } | null;
}

interface AiUsageSummary {
  totalCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  byFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }[];
  last30Days: { date: string; calls: number; estimatedCostUsd: number }[];
}

const FEATURE_LABELS: Record<string, string> = {
  chat: 'Assistente (chat)',
  nfe_extraction: 'Extração de NF-e',
  contract_analysis: 'Leitura de contratos',
  risco_narrative: 'Narrativa de risco',
  dispute_copilot: 'Copiloto de disputas',
  sinistro_copilot: 'Copiloto de sinistro',
  pld_second_opinion: 'Segunda opinião PLD',
  compliance_engine: 'Compliance AI Engine',
  legal_collection: 'Cobrança jurídica (IA)',
  regulatory_monitor: 'Monitor regulatório (IA)',
  legal_draft: 'Minutas jurídicas (IA)',
};

export function IaUsagePanel() {
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [mlScoring, setMlScoring] = useState<MlScoringStatus | null>(null);
  const [retrainingMl, setRetrainingMl] = useState(false);
  const [mlRetrainMessage, setMlRetrainMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAiUsage = () => api.get<AiUsageSummary>('/admin/ai-usage').then(setAiUsage);
  const loadMlScoring = () => api.get<MlScoringStatus>('/admin/ml-scoring').then(setMlScoring);

  const loadAll = () => {
    setLoadError(null);
    Promise.all([loadAiUsage(), loadMlScoring()]).catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar uso de IA.'));
  };

  useEffect(() => {
    loadAll();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadAll} />;

  const retrainMl = async () => {
    setRetrainingMl(true);
    setMlRetrainMessage('');
    try {
      const result = await api.post<{ trained: boolean; reason?: string }>('/admin/ml-scoring/retrain');
      setMlRetrainMessage(result.trained ? 'Modelo retreinado com sucesso.' : result.reason ?? 'Não foi possível treinar.');
      await loadMlScoring();
    } finally {
      setRetrainingMl(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-textSecondary text-[12.5px]">
        Custo é uma estimativa (taxa por token configurável no servidor) a partir dos tokens reais que a API da Anthropic retornou em cada chamada —
        útil para identificar qual recurso está gerando mais gasto, não é uma fatura. Cada rota que chama a IA também tem limite de 30 chamadas por
        usuário a cada 15 minutos.
      </div>

      {mlScoring && (
        <div className="bg-white border border-border rounded-card p-5">
          <div className="flex items-center justify-between flex-wrap gap-2.5 mb-2">
            <div className="font-bold text-[14px]">Score de crédito — modelo treinado (ML)</div>
            <Button size="sm" variant="secondary" disabled={retrainingMl} onClick={retrainMl}>
              {retrainingMl ? 'Treinando…' : 'Retreinar agora'}
            </Button>
          </div>
          {mlScoring.model ? (
            <div className="text-[12.5px] text-textSecondary">
              <div>
                Modelo: <b>{mlScoring.model.kind === 'mlp' ? 'rede neural (MLP)' : 'regressão logística'}</b>
                {mlScoring.model.kind === 'logistic' && (
                  <> — vira rede neural automaticamente a partir de {mlScoring.minNeuralNetSamples} amostras (poucas para isso hoje, ver Agentes IA)</>
                )}
              </div>
              Treinado em {new Date(mlScoring.model.trainedAt).toLocaleString('pt-BR')} com {mlScoring.model.nSamples} amostras (
              {mlScoring.model.nPositive} com resultado ruim) — acurácia de treino {(mlScoring.model.trainAccuracy * 100).toFixed(0)}%. Usado pelo
              Agente de Underwriting (ferramenta <code>prever_probabilidade_ml</code>).
              {mlScoring.model.featureImportance && (
                <div className="mt-2">
                  <div className="font-bold text-navy mb-1">Importância por variável (permutação)</div>
                  {mlScoring.model.featureImportance.map((f) => (
                    <div key={f.name} className="flex items-center gap-2">
                      <span className="w-40">{f.name}</span>
                      <div className="flex-1 h-2 bg-bg rounded-full overflow-hidden">
                        <div className="h-full bg-blue" style={{ width: `${(f.importance * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="font-mono-num">{(f.importance * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12.5px] text-textSecondary">
              Nenhum modelo treinado ainda — mínimo de {mlScoring.minTrainingSamples} duplicatas com resultado real (sinistro aprovado ou recuperação
              jurídica) na base.
            </div>
          )}
          {mlRetrainMessage && <div className="text-[12px] font-bold text-blue mt-2">{mlRetrainMessage}</div>}
        </div>
      )}
      {aiUsage && (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="bg-white border border-border rounded-card p-4">
              <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Chamadas totais</div>
              <div className="text-[22px] font-bold">{aiUsage.totalCalls}</div>
              {aiUsage.failedCalls > 0 && <div className="text-[11.5px] text-red mt-0.5">{aiUsage.failedCalls} com falha</div>}
            </div>
            <div className="bg-white border border-border rounded-card p-4">
              <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tokens de entrada</div>
              <div className="text-[22px] font-bold">{aiUsage.totalInputTokens.toLocaleString('pt-BR')}</div>
            </div>
            <div className="bg-white border border-border rounded-card p-4">
              <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Tokens de saída</div>
              <div className="text-[22px] font-bold">{aiUsage.totalOutputTokens.toLocaleString('pt-BR')}</div>
            </div>
            <div className="bg-white border border-border rounded-card p-4">
              <div className="text-textTertiary text-[11.5px] uppercase font-bold mb-1">Custo estimado</div>
              <div className="text-[22px] font-bold">US$ {aiUsage.totalEstimatedCostUsd.toFixed(2)}</div>
            </div>
          </div>

          <div className="bg-white border border-border rounded-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border font-bold text-[14px]">Por recurso</div>
            {aiUsage.byFeature.map((f) => (
              <div key={f.feature} className="px-5 py-3 border-b border-[#F5F7FA] last:border-b-0 flex items-center justify-between gap-3 text-[13px]">
                <div className="font-bold">{FEATURE_LABELS[f.feature] ?? f.feature}</div>
                <div className="text-textSecondary flex items-center gap-4">
                  <span>{f.calls} chamadas</span>
                  <span>
                    {f.inputTokens.toLocaleString('pt-BR')} / {f.outputTokens.toLocaleString('pt-BR')} tok
                  </span>
                  <span className="font-mono-num font-bold text-textPrimary">US$ {f.estimatedCostUsd.toFixed(3)}</span>
                </div>
              </div>
            ))}
            {aiUsage.byFeature.length === 0 && <EmptyState title="Nenhuma chamada de IA registrada ainda" hint="Cada recurso assistido por IA aparece aqui após a primeira chamada" />}
          </div>
        </>
      )}
    </div>
  );
}
