import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The site is served from https://d1se0.github.io/StreamGrab/ — GitHub Pages project sub-path
export default defineConfig({
  base: '/StreamGrab/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true, // RTL auto-cleanup after each test
    setupFiles: './tests/setup.js',
    include: ['tests/**/*.test.jsx', 'src/**/*.test.jsx'],
  },
});
