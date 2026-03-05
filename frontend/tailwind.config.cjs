/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,jsx,js}'],
  theme: {
    extend: {
      colors: {
        approve: '#22c55e',
        flag: '#eab308',
        block: '#ef4444'
      }
    }
  },
  plugins: []
};

