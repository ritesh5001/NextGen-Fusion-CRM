import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Trap is nextgenfusion.in's typeface (self-hosted in public/fonts, see index.css).
      fontFamily: {
        sans: ['Trap', 'Inter', ...defaultTheme.fontFamily.sans],
      },
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
        // The other two stops of the site's signature gradient.
        fusion: {
          violet: '#8a38f5',
          cyan: '#13cbd4',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(to right, #2b35ab, #8a38f5 50%, #13cbd4)',
        'brand-gradient-br': 'linear-gradient(to bottom right, #2b35ab, #8a38f5)',
      },
      borderRadius: {
        // The site's buttons: squarer than rounded-xl, softer than rounded-lg.
        btn: '10px',
      },
    },
  },
  plugins: [],
};
