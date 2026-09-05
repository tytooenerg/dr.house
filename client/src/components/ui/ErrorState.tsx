// Estado de erro pra carga inicial via useEffect — usado quando a API falha e a tela não
// deve nem travar em "Carregando…" pra sempre, nem parecer silenciosamente vazia (mesmo
// visual de EmptyState, mas deixando claro que é uma falha, com um jeito de tentar de
// novo sem precisar recarregar a página inteira).
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-12 px-5 text-center">
      <div className="font-bold text-[14px] text-red">Não foi possível carregar</div>
      <div className="text-textSecondary text-[13px] mt-1">{message}</div>
      <button type="button" onClick={onRetry} className="mt-3 text-[12.5px] font-bold text-blue bg-transparent border-none cursor-pointer">
        Tentar de novo
      </button>
    </div>
  );
}
