/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './frontend/index.html',
    './frontend/js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        student: { 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
        teacher: { 50: '#f0fdf4', 100: '#dcfce7', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' }
      }
    }
  }
};
