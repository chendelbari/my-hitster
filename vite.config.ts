import { defineConfig } from 'vite';

// Spotify only accepts loopback IPs (not "localhost") as http redirect URIs,
// so the dev server must run on 127.0.0.1:5173 to match the registered
// http://127.0.0.1:5173/callback. The production build lives under
// https://chendelbari.github.io/my-hitster/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/my-hitster/' : '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
