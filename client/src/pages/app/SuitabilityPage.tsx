import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface SuitabilityOption {
  value: string;
  label: string;
  points: number;
}
interface SuitabilityQuestion {
  id: string;
  text: string;
  options: SuitabilityOption[];
}
interface SuitabilityView {
  hasAssessment: boolean;
  profile: 'conservador' | 'moderado' | 'arrojado' | null;
  profileLabel: string | null;
  score: number | null;
  maxScore: number;
  completedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

const PROFILE_COLOR: Record<string, string> = { conservador: '#0A5C36', moderado: '#8A6D00', arrojado: '#B42318' };

export function SuitabilityPage() {
  const [questions, setQuestions] = useState<SuitabilityQuestion[]>([]);
  const [current, setCurrent] = useState<SuitabilityView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    api.get<{ questions: SuitabilityQuestion[]; current: SuitabilityView }>('/suitability').then((d) => {
      setQuestions(d.questions);
      setCurrent(d.current);
    });

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setError('');
    if (Object.keys(answers).length < questions.length) {
      setError('Responda todas as perguntas antes de enviar.');
      return;
    }
    setSubmitting(true);
    try {
      const view = await api.post<SuitabilityView>('/suitability/submit', { answers });
      setCurrent(view);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar suas respostas.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Perfil de Investidor"
        subtitle="Questionário de suitability (adequação) — determina quais cestas de investimento você pode usar, seguindo o mesmo princípio das normas da CVM sobre adequação de produto ao perfil do investidor"
      />

      {current && (
        <Card className="mb-4">
          <div className="font-bold text-[15px] mb-2">Seu perfil atual</div>
          {current.hasAssessment ? (
            <div className="flex items-center gap-4 flex-wrap">
              <span
                className="text-[13px] font-bold px-3 py-1 rounded-full"
                style={{ background: `${PROFILE_COLOR[current.profile!]}1A`, color: PROFILE_COLOR[current.profile!] }}
              >
                {current.profileLabel}
              </span>
              <span className="text-[12.5px] text-textSecondary">
                Pontuação {current.score}/{current.maxScore}
              </span>
              <span className="text-[12.5px] text-textSecondary">
                {current.expired ? 'Expirado em' : 'Válido até'} {current.expiresAt ? new Date(current.expiresAt).toLocaleDateString('pt-BR') : '—'}
              </span>
              {current.expired && <span className="text-[12px] font-bold text-red">Refaça o questionário — seu perfil expirou.</span>}
            </div>
          ) : (
            <p className="text-[12.5px] text-textSecondary">
              Você ainda não respondeu o questionário. Sem um perfil válido, apenas a cesta Conservadora fica disponível em Cestas de Investimento.
            </p>
          )}
        </Card>
      )}

      <Card>
        <div className="font-bold text-[15px] mb-3.5">{current?.hasAssessment ? 'Refazer questionário' : 'Responder questionário'}</div>
        <div className="flex flex-col gap-5">
          {questions.map((q) => (
            <div key={q.id}>
              <div className="text-[13px] font-semibold mb-2">{q.text}</div>
              <div className="flex flex-col gap-1.5">
                {q.options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-[12.5px] cursor-pointer">
                    <input
                      type="radio"
                      name={q.id}
                      value={o.value}
                      checked={answers[q.id] === o.value}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: o.value }))}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {error && <div className="mt-3 text-red text-[12.5px] font-semibold">{error}</div>}
        <div className="mt-4">
          <Button disabled={submitting} onClick={submit}>
            {submitting ? 'Enviando…' : 'Enviar respostas'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
