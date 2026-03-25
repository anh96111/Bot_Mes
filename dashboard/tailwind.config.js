/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0084ff',
        secondary: '#f0f2f5',
        success: '#00c851',
        danger: '#ff4444',
        warning: '#ffbb33',
      }
    },
  },
  plugins: [],
}
