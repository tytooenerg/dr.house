export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="py-12 px-5 text-center">
      <div className="w-11 h-11 rounded-full border-2 border-inputBorder mx-auto mb-3.5" />
      <div className="font-bold text-[14.5px]">{title}</div>
      <div className="text-textSecondary text-[13px] mt-1">{hint}</div>
    </div>
  );
}
