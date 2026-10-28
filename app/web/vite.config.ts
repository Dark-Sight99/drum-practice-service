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
    // 2026-10-28 — 의뢰인이 Tailscale Funnel/Serve(홈서버를 맥·아이폰 등
    // 다른 기기에서 접속하는 용도, intent/03-architecture-stack.md §2
    // "집 PC=서버" 구조)로 접속하려다 403 Blocked request를 맞음 — Vite
    // 5+ 보안 기능(알 수 없는 Host 헤더로 DNS 리바인딩 공격 방지)이 기본적으로
    // localhost 계열 외 호스트명을 차단한다. 본인 소유 tailnet(개인 전용,
    // 타인 접근 불가 — tailscale status로 확인한 기기 목록이 본인 것뿐)
    // 안에서만 쓰는 호스트명이라 허용해도 그 보안 기능이 막으려던 공격
    // 시나리오(공인 웹사이트가 피해자 브라우저를 통해 로컬 서버에 요청을
    // 보내게 하는 것)에 해당하지 않음. `.tail756a35.ts.net`로 같은 tailnet
    // 안의 호스트명 전부를 허용(기기 이름이 바뀌어도 재설정 불필요).
    allowedHosts: ['.tail756a35.ts.net'],
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
