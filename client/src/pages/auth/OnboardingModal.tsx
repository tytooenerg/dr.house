import { ModalOverlay } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { useSession } from '../../state/SessionContext';

export function OnboardingModal() {
  const { session, onboardingNext, onboardingSkip } = useSession();
  if (!session) return null;
  const { onboardingSteps, onboardingStep, onboardingCurrent, onboardingIsLast } = session;

  return (
    <ModalOverlay>
      <div className="flex gap-1.5 mb-[22px]">
        {onboardingSteps.map((_, i) => (
          <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i === onboardingStep ? '#1E5EFF' : '#E4E8EE' }} />
        ))}
      </div>
      <div className="text-[21px] font-extrabold mb-2.5">{onboardingCurrent.title}</div>
      <div className="text-[14.5px] text-textSecondary leading-relaxed mb-7">{onboardingCurrent.body}</div>
      <div className="flex justify-between items-center">
        <button type="button" className="bg-transparent border-none text-textSecondary text-[13px] font-bold cursor-pointer" onClick={onboardingSkip}>
          Pular
        </button>
        <Button onClick={onboardingNext}>{onboardingIsLast ? 'Começar' : 'Próximo'}</Button>
      </div>
    </ModalOverlay>
  );
}
