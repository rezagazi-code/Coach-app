import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    // Relative asset paths: required for Capacitor (file/capacitor scheme)
    // and harmless for the web build served from domain root.
    base: './',
    plugins: [react(), tailwindcss()],
    server: {
      port: 3001,
    },
  };
});
