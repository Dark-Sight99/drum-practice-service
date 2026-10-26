> 한 줄 요약: T3-16-feedback-3(Web Audio를 iOS 전용으로 제한) 이후에도 맥에서 가끔(빈도는 크게 줄었음) 음악 재생 중 순간적인 네트워크 재연결이 들림 — 서버 로그엔 에러 없어 네트워크 구간 자체의 문제로 판단, 재생 버튼을 누르기 전에 미리 스템 파일을 백그라운드로 받아둬서 그 순간이 "재생 중"이 아니라 "조용한 시점"에 나도록 완화.

# T3-16-feedback-4(네트워크 프리페치) QA 결과

## 근거(REQ)
REQ-04/05. T3-16-feedback-3(Web Audio iOS 전용화) 병합 후 의뢰인이 맥에서 재확인 — 끊김 빈도는 "훨씬 줄었지만 완전히는 아니다"라고 보고, 더 개선을 요청.

## 원인 (실측)
- Safari 네트워크 탭: `stem_vocals` 요청 하나가 184ms 만에 빨간색(취소)으로 끊겼다가, 끊긴 지점(1,245,184바이트)부터 바로 이어받는 재요청으로 자동 복구됨. 나머지 3개(drums/other/bass)는 한 번에 깔끔히 완료.
- 서버 로그(`app/server` uvicorn stdout/stderr) 확인: 그 시간대 요청 전부 `206 Partial Content`로 정상 처리, 에러·예외 없음 — **서버 쪽 버그가 아니라 맥↔서버 사이 네트워크 구간의 순간적인 연결 끊김**(Tailscale/와이파이 등 실제 네트워크에서 드물게 있을 수 있는 수준).
- 현재 구조: `PracticeCanvas.tsx`의 `createTrackPlayer()`는 ▶재생 버튼을 눌러야(`handlePlay()`) 비로소 만들어지고, 그 순간 4개 스템 파일 다운로드가 동시에 시작됨 — 즉 네트워크가 순간적으로 끊기면 **재생 중**에 그 영향을 직접 듣게 됨.

## 변경 내용 (`app/web/src/features/practice/PracticeCanvas.tsx`만 수정)
`songId`/`availableAudioKinds`가 바뀔 때(연습 화면에 곡이 로드될 때) 도는 새 `useEffect` 추가 — 스템 URL마다 `fetch()`만 호출해 브라우저 캐시를 미리 데운다:
```ts
const availableAudioKindsKey = availableAudioKinds.join(',')
useEffect(() => {
  if (songId === undefined) return
  const stemKinds = availableAudioKinds.filter((kind) => kind !== 'original')
  for (const kind of stemKinds) {
    void fetch(songAudioUrl(songId, kind)).catch(() => {})
  }
}, [songId, availableAudioKindsKey])
```
- `createTrackPlayer()`/`handlePlay()`의 복잡한 세션 상태 관리(T3-6 등에서 누적된 재진입 가드·정리 로직)는 **전혀 안 건드림** — 완전히 독립된 부수효과.
- 서버의 `GET /songs/{id}/audio/{kind}`(Starlette `FileResponse`)가 `etag`/`last-modified`를 기본으로 보내므로(소스 확인), 이 프리페치가 받아둔 응답을 브라우저가 캐시에 남겼다가 재생 시점 요청에서 재사용할 근거가 있음(명시적 `Cache-Control` 헤더는 없어 완전한 "재다운로드 생략"까지는 보장 못 하지만, 최소한 조건부 재검증(304)으로 본문 재전송은 피할 수 있음 — 추측 아니라 실제 소스 확인).
- 실패해도 조용히 무시(`.catch(() => {})`) — 어차피 재생 시점에 `createTrackPlayer()`가 다시 받으므로 에러 처리 불필요.
- `join(',')`을 의존성으로 써서 부모가 매 렌더마다 새 배열을 내려줘도(내용이 같으면) 불필요하게 재요청하지 않음.

## 위험 분류
재생 로직·세션 상태 관리와 완전히 분리된 부수적 프리페치 추가 — 실패해도 무시되므로 기존 동작에 영향 없음. 오디오 타이밍 자체는 무관 — 모드C 불필요, 모드A만 진행.

## 자동 테스트
```
cd app/web
npx tsc -p tsconfig.app.json --noEmit   # 이번 변경으로 인한 새 오류 0건
npm run lint                             # oxlint 통과, 경고 없음
npm test -- --run                        # 17 test files / 202 tests 모두 통과
```
`PracticeCanvas.tsx`는 이 프로젝트에서 원래 전용 단위 테스트 파일이 없음(Canvas 2D 컨텍스트가 jsdom에 없어 실제 브라우저로만 검증 가능하다는 기존 방침, T2-3 등) — 이번 변경도 그 방침을 그대로 따름.

## 브라우저 수동 검증 — 제한적
로그인 자격증명이 없어 실제 프리페치 fetch 호출·네트워크 탭에서의 효과를 직접 확인 못함. **의뢰인이 맥에서 연습 화면에 들어가자마자(재생 누르기 전) 네트워크 탭에 `stem` 요청이 미리 뜨는지, 그리고 이후 실제 재생 시 끊김 체감이 더 줄었는지 확인 필요.**

## 결론
근본적인 네트워크 불안정(서버 버그 아님, 실제 네트워크 구간 문제)을 완전히 없앨 순 없지만, "조용한 시점에 미리 끊기게" 만들어 체감 영향을 줄이는 완화책. 그래도 남으면 더 공격적인 재시도/버퍼링 전략(더 큰 작업)을 다음 단계로 검토.
