/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      zIndex: {
        'tooltip': '10',
        'dropdown': '20',
        'drawer': '30',
        'header': '40',
        'modal': '50',
        'toast': '60',
      }
    },
  },
  plugins: [],
}