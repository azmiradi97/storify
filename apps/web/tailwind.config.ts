import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Brand → fresh green (was indigo). Stops are picked for their ROLE:
        // 600 = button fill (white text), 400 = green text on light, 500 = the
        // accent hue for rings/highlights. See UI-refresh Phase 1.
        brand: {
          50: '#E8F7EF',
          100: '#C8ECD9',
          200: '#97DBBB',
          300: '#59C596',
          400: '#0F6B48',
          500: '#1FA971',
          600: '#17835A',
          700: '#116646',
          800: '#0D4E36',
          900: '#0A3A28',
        },
        // ── Cheerful warm-yellow accent (new).
        accent: {
          50: '#FFF9E6',
          100: '#FFF0C2',
          200: '#FFE28A',
          300: '#FFD25C',
          400: '#FFC53D',
          500: '#F5A623',
          600: '#C77F12',
          700: '#8A5A00',
        },
        // ── Neutral ramp REDEFINED for the LIGHT theme. The app uses low stops
        // (50–200) for text and high stops (700–900) for surfaces, so the ramp
        // is intentionally inverted in darkness (50 = deep ink … 900 = near
        // white) with a slight green bias. This flips dark→light without
        // touching the 55 component files that reference these tokens.
        gray: {
          50: '#12261E',
          100: '#1B3A2E',
          200: '#294A3D',
          300: '#3E5C4F',
          400: '#5C726A',
          500: '#718880',
          600: '#9FB3AA',
          700: '#D8E2DB',
          750: '#E7EEE8',
          800: '#EEF4ED',
          900: '#F7FAF6',
        },
        success: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
        },
        info: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        pink: { 500: '#EC4899' },
        cyan: { 500: '#06B6D4' },
        violet: { 500: '#8B5CF6' },
        teal: { 500: '#14B8A6' },
        app: '#F2F6F1',
      },
      fontFamily: {
        display: ['Cairo', 'IBM Plex Sans Arabic', 'sans-serif'],
        body: ['Cairo', 'IBM Plex Sans Arabic', 'sans-serif'],
        numeric: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        sans: ['Cairo', 'IBM Plex Sans Arabic', 'sans-serif'],
      },
      spacing: {
        'sp-1': '4px',
        'sp-2': '8px',
        'sp-4': '16px',
        'sp-6': '24px',
        'sp-8': '32px',
        'sp-12': '48px',
      },
      borderRadius: {
        'r-sm': '4px',
        'r-md': '8px',
        'r-lg': '12px',
        'r-xl': '16px',
        'r-2xl': '24px',
        'r-full': '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        brand: '0 6px 16px 0 rgb(31 169 113 / 0.28)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
        spring: '400ms',
      },
      zIndex: {
        dropdown: '100',
        modal: '400',
        toast: '500',
      },
      animation: {
        'fade-in': 'fadeIn 300ms ease both',
        'fade-in-up': 'fadeInUp 250ms ease both',
        shimmer: 'shimmer 1500ms infinite',
        'spin-slow': 'spin 1000ms linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
