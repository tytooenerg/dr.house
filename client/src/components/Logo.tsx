export function Logo({ size = 26, wordmark = true, dark = false }: { size?: number; wordmark?: boolean; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 80 56" style={{ width: size, height: size * 0.7 }}>
        <rect x="16" y="24" width="14" height="18" rx="3" fill="#1E5EFF" />
        <rect x="33" y="16" width="14" height="26" rx="3" fill="#1E5EFF" />
        <rect x="50" y="8" width="14" height="34" rx="3" fill="#1E5EFF" />
      </svg>
      {wordmark && (
        <span className={`font-extrabold tracking-tight text-lg ${dark ? 'text-white' : 'text-navy'}`}>Lastro</span>
      )}
    </div>
  );
}
