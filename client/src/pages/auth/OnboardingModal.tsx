import { useEffect, useState } from 'react';
import { ModalOverlay } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useSession } from '../../state/SessionContext';

export function OnboardingModal() {
  const { user, completeOnboarding } = useSession();
  const [step, setStep] = useState(0);
  const steps = user?.onboardingSteps ?? [];
  const hasSteps = steps.length > 0;

  // Some roles (e.g. admin) have no onboarding steps by design — nothing to show,
  // so skip straight past it instead of indexing into an empty array. Runs as an
  // effect, not during render, since completeOnboarding updates session state.
  useEffect(() => {
    if (user && !hasSteps) completeOnboarding();
  }, [user, hasSteps, completeOnboarding]);

  if (!user || !hasSteps) return null;
  const isLast = step >= steps.length - 1;
  const current = steps[step] ?? steps[0];

  return (
    <ModalOverlay onClose={completeOnboarding}>
      <div className="flex gap-1.5 mb-[22px]">
        {steps.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i === step ? '#1E5EFF' : '#E4E8EE' }} />
        ))}
      </div>
      <div className="text-[21px] font-extrabold mb-2.5">{current.title}</div>
      <div className="text-[14.5px] text-textSecondary leading-relaxed mb-7">{current.body}</div>
      <div className="flex justify-between items-center">
        <button type="button" className="bg-transparent border-none text-textSecondary text-[13px] font-bold cursor-pointer" onClick={completeOnboarding}>
          Pular
        </button>
        <Button onClick={() => (isLast ? completeOnboarding() : setStep(step + 1))}>{isLast ? 'Começar' : 'Próximo'}</Button>
      </div>
    </ModalOverlay>
  );
}
