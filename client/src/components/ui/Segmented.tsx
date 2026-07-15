export function Segmented<T extends string>({ options, value, onChange, dark = false }: { options: T[]; value: T; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex-1 py-2.5 rounded-lg border text-[13px] font-bold cursor-pointer transition-colors ${
              dark ? 'border-white/20' : 'border-inputBorder'
            }`}
            style={{
              background: active ? '#1E5EFF' : dark ? 'transparent' : '#fff',
              color: active ? '#fff' : dark ? '#fff' : '#0B1F3A',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
