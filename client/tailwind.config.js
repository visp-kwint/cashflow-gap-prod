/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Палитра «In Color Balance» (четыре образца):
      // #2A2B2F графит, #979AA1 серо-голубой, #9CAD76 шалфей, #495736 олива.
      // slate → графитовая шкала, emerald → шалфейно-оливковая;
      // rose остаётся для danger. Шкалы в extend — чтобы не стереть остальные семейства.
      colors: {
        slate: {
          50: '#f5f5f6',
          100: '#dcdcde',
          200: '#bfc0c5',
          300: '#a5a6ac',
          400: '#979aa1',
          500: '#7c7e86',
          600: '#5f616a',
          700: '#4a4b52',
          800: '#3a3b41',
          900: '#2a2b2f',
          950: '#1f2024',
        },
        emerald: {
          50: '#f4f7ec',
          100: '#e7eeda',
          200: '#d0dcba',
          300: '#b9ca9d',
          400: '#a8bb8a',
          500: '#9cad76',
          600: '#7f915f',
          700: '#55663f',
          800: '#495736',
          900: '#3a452c',
          950: '#232b1b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
