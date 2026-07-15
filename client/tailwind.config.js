/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        '4.5': '18px',
        '5.5': '22px',
        '6.5': '26px',
        '7.5': '30px',
      },
      colors: {
        blue: '#1E5EFF',
        navy: '#0B1F3A',
        bg: '#F5F7FA',
        border: '#E4E8EE',
        hairline: '#F0F2F5',
        inputBorder: '#D6DCE5',
        textPrimary: '#0B1F3A',
        textSecondary: '#5B6472',
        textTertiary: '#8B97AC',
        textMuted: '#9AA5B5',
        green: '#0A5C36',
        greenBg: '#EAF3EE',
        amber: '#B8790A',
        amberBg: '#FBF1E0',
        red: '#B03A2E',
        redBg: '#F7E9E7',
        chip: '#EEF3FF',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        dropdown: '0 12px 32px rgba(11,31,58,0.14)',
        modal: '0 16px 40px rgba(11,31,58,0.18)',
        fab: '0 8px 20px rgba(30,94,255,0.35)',
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
};
