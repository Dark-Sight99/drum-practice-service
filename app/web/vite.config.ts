import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '드럼 연습 서비스',
        short_name: '드럼연습',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f1115',
        theme_color: '#0f1115',
      },
    }),
  ],
  server: {
    // work/T2-5/plan.md §설계 3 — 브라우저 입장에서 전부 동일 출처 요청이 되게 해
    // CORS·크로스 포트 쿠키 문제를 피한다. FastAPI는 접두사 없이 그대로 두고
    // 프록시가 /api 접두사만 벗겨서 전달한다.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
