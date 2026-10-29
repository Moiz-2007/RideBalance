/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f1117',
          100: '#161b25',
          200: '#1e2535',
          300: '#252e42',
        },
        accent: {
          DEFAULT: '#10b981',
          light: '#34d399',
          dark: '#059669',
        },
        border: {
          DEFAULT: '#2a3347',
          light: '#3a4560',
        },
        text: {
          primary: '#e8ecf4',
          secondary: '#8892a4',
          muted: '#4d5a70',
        },
        strategy: {
          B0: '#64748b',
          B1: '#f59e0b',
          B2: '#3b82f6',
          P: '#10b981',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
