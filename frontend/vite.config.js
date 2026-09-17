import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy. UI chạy ở :5173, backend aibox.py ở :8090, go2rtc WS ở :1984.
// /api/ws cần proxy ws:true tới go2rtc (1984). Các route REST khác -> 8090.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/aibox': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/alarm': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/alarms': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/api/ws': {
        target: 'ws://localhost:1984',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});