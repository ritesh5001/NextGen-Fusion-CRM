/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // NextGen Fusion brand indigo (#2B35AB, from nextgenfusion.in) sits at 600.
        brand: {
          50: '#eef0fb',
          100: '#dde1f7',
          200: '#bcc3ef',
          300: '#939ee4',
          400: '#6772d6',
          500: '#4450c6',
          600: '#2b35ab',
          700: '#232b8c',
          800: '#1c236f',
          900: '#161b56',
        },
      },
    },
  },
  plugins: [],
};
