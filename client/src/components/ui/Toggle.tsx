export function Toggle({ on, onClick, size = 'md' }: { on: boolean; onClick: () => void; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? { w: 48, h: 28, knob: 22, pad: 3 } : size === 'sm' ? { w: 40, h: 24, knob: 18, pad: 3 } : { w: 44, h: 26, knob: 20, pad: 3 };
  const left = on ? dims.w - dims.knob - dims.pad : dims.pad;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-full border-none cursor-pointer flex-shrink-0 transition-colors"
      style={{ width: dims.w, height: dims.h, background: on ? '#1E5EFF' : '#D6DCE5' }}
    >
      <span
        className="absolute rounded-full bg-white transition-all"
        style={{ width: dims.knob, height: dims.knob, top: dims.pad, left }}
      />
    </button>
  );
}
