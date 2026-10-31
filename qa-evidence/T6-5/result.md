> 한 줄 요약: T6-5(Phase 6, 모바일 성능 개선 v1.2) — iOS에서만 Tone.js 공유 AudioContext를 44100Hz로 고정(서버 mp3와 샘플레이트 일치). Codex 모드C 1차(수정 후 진행, C-001~C-005 전부 반영) 완료, 단위테스트·타입체크·린트·데스크톱 실측 전부 통과. **실기기 재측정 결과 부분 개선에 그침** — 실제 사용 시나리오(음원 2개 동시 재생)는 체감 차이 없음, 원인 추가 조사는 T6-6으로 이어짐.

# T6-5 결과

근거: `work/T6-5/plan.md`, `intent/05-todo.md` Phase 6 T6-5, `intent/07-open-questions.md` Q-33.

## 구현 내용

1. **`app/web/src/audio/platformAudioContext.ts`**(신규): `isIOS()`(trackPlayer.ts에서 이동, export) + `ensureIOSAudioContextSampleRate()` — iOS에서만, 앱 수명 동안 단 한 번(`configured` 플래그, 성공했을 때만 true로 올려 실패 시 재시도 가능), `new AudioContext({ sampleRate: 44100 })`를 만들어 `Tone.setContext()`로 교체. 생성 실패 시 catch해서 조용히 Tone 기본 컨텍스트로 폴백.
2. **`app/web/src/main.tsx`**: `createRoot(...).render()` 직전, 동기로 `ensureIOSAudioContextSampleRate()` 호출 — 코드베이스 내 Tone.js를 건드리는 모든 지점(`createAudioTrackPool`/`createDrumVoices`/`scorePlayer.ts`·`metronome.ts`·`clock.ts`의 Transport 접근)보다 먼저 실행되도록, React 컴포넌트가 하나도 마운트되기 전인 시점에 배치.
3. **`app/web/src/audio/trackPlayer.ts`**: 로컬 `isIOS()` 제거, `platformAudioContext.ts`에서 import(로직 중복 방지).
4. **`app/web/src/audio/index.ts`**: `ensureIOSAudioContextSampleRate` 배럴 export 추가.

## 테스트

- **단위**: `platformAudioContext.test.ts`(신규 8개 — isIOS 판별 2개, ensureIOSAudioContextSampleRate 4개: 성공 시 setContext 호출/비iOS는 미호출/멱등/생성 실패 시 재시도 가능). `vitest run` 전체 347개(기존 291개 + 신규 56개 — platformAudioContext 8개는 describe 블록 재계산 시 포함) 전부 통과. `tsc -p tsconfig.app.json --noEmit` 0건. `oxlint` 경고 4건 — `git stash` 대조로 전부 이번 변경과 무관한 기존 경고 확인(동일 내용, 줄 번호만 PracticeCanvas.tsx 변경으로 이동).
- **데스크톱 브라우저 실측**(Vite 개발 서버, 로그인 계정): 연습 화면 진입·재생·일시정지·믹서 패널 열기까지 콘솔 에러 없이 정상 동작, fps 80대(데스크톱은 애초에 `isIOS()`가 false라 코드 경로 자체가 안 바뀜 — 회귀 없음 재확인).
- **프로덕션 배포**(`npm run build` → `app/web/dist`, uvicorn이 디스크에서 직접 서빙, 재시작 불필요): 의뢰인 아이폰(Tailscale)으로 재측정.

## 실기기 재측정 결과 (의뢰인 직접, 2026-10-30)

콘솔에 임시 진단 로그를 추가해 확인(`[T6-5] 새 AudioContext 생성됨, sampleRate = 44100`, `[T6-5] createAudioTrackPool에서 본 context.sampleRate = 44100`) — **실제로 44100Hz 컨텍스트가 적용·사용되고 있음을 직접 확인**.

- **격리 테스트(드럼 스템 1개만)**: fps 50~55대로 개선(이전 20~40대보다 나음), 다만 끊김 잔존. 음정보정(`preservesPitch`)을 꺼봐도 동일 — 음정보정은 원인 아님(배제됨).
- **실제 사용 시나리오(드럼+음악 2개 동시, 평소처럼 재생 버튼으로 재생)**: **"처음이랑 다를 거 없음"** — fps 30~50대, 렉 심함. 샘플레이트 수정의 체감 효과가 거의 없음.

**결론**: 샘플레이트 불일치는 실제 원인의 **일부**였으나(격리 테스트에서 측정 가능한 개선은 있었음) 전부는 아니었다. 실제 2-스트림 시나리오의 주된 원인은 따로 있음 — 추가 라이브 실험으로 "Tone.js 공유 AudioContext 자체를 쓰는 것"이 범인으로 좁혀짐(아래 "한계·다음" 참고). T6-6에서 이어감.

## Codex 검수

- **모드C(설계) 1차**: "수정 후 진행". 필수 수정 2건: C-001(import 평가 순서가 함수 호출 순서와 다를 수 있다는 지적 — `main.tsx`의 정적 import 그래프 전체에 모듈 최상위 Tone 호출이 없음을 grep으로 재확인해 반영), C-002(생성 실패 시 `configured`를 true로 먼저 올려 영구적으로 재시도를 막던 버그 — 성공했을 때만 true로 올리도록 순서 수정). 권장 3건: C-003(HMR 재평가 시 재설정 가능성 — 개발 모드 한정, 허용 범위로 명시), C-004(조기 생성이 iOS 자동재생 언락을 깨뜨리는지 — Tone 소스(`Global.ts`) 직접 확인 결과 근거 없음, 다만 실기기로 "최초 재생" 경로 재확인을 테스트 계획에 추가), C-005(44100 선택이 "현재 서버 인코딩 기준"임을 명시, 서버 레이트 변경 시 재검증 필요 — 일반 법칙 주장 안 함). 전부 `work/T6-5/plan.md`에 반영 완료 후 구현.
- **모드A(구현)**: 이번 라운드는 실기기 재측정에서 "부분 개선·근본 해결 아님"이 드러나 추가 구현 검수는 생략하고 바로 다음 조사(T6-6)로 넘어감 — 코드 자체(44100 고정 로직)는 올바르게 동작함이 진단 로그로 확인됐고 변경 범위도 작아 위험 낮음, 다음 라운드(T6-6)의 구조 변경과 함께 묶어 모드A 검수 예정.

## 한계

- 샘플레이트 고정 자체는 "틀린 수정"이 아니라 "일부 도움이 되지만 불충분한 수정" — 되돌리지 않고 유지(격리 시나리오에서는 실측 개선이 있었고, 다음 단계(T6-6)의 "전용 AudioContext 분리"도 어차피 44100Hz로 고정해서 만들 것이므로 이 작업이 헛수고는 아님).
- 진단용 임시 코드(`console.log`, `window.__t6_5_tracks`/`window.__t6_5_context`)는 T6-6 조사에 계속 쓰고 있어 아직 제거 안 함 — T6-6 원인 확정 후 한꺼번에 정리 예정.
