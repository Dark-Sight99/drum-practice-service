import '@testing-library/jest-dom/vitest'

// jsdom은 window.matchMedia를 구현하지 않는다(https://github.com/jsdom/jsdom/issues/3522).
// T5-1(2026-10-30)에서 App.tsx가 반응형 훅(useCompactHeaderLayout)을 처음으로
// 직접 호출하면서 App.test.tsx(로그인 화면 등, PracticeCanvas를 거치지 않는
// 테스트)에서도 렌더링 때마다 matchMedia가 호출돼 "matchMedia is not a
// function"으로 깨짐 — 표준 jsdom 테스트 폴리필(항상 matches:false)로 보강.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
