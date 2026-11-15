/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        detran: {
          50: '#eef5fc',
          100: '#d6e6f7',
          200: '#aecdef',
          300: '#7facdf',
          400: '#4d87c9',
          500: '#2a67ae',
          600: '#1b5090',
          700: '#143d72',
          800: '#0f2e57',
          900: '#0b2340',
        },
        acento: {
          500: '#00855a',
          600: '#046b4a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        painel: '0 1px 2px rgba(11, 35, 64, 0.06), 0 8px 24px -12px rgba(11, 35, 64, 0.18)',
      },
    },
  },
  plugins: [],
};
