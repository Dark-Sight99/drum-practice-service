> 한 줄 요약: Codex 모드A의 "A-B 루프 진행바가 카운트인을 반영 안 함" 지적을 반박하기 위해 실제 브라우저에서 캡처한 디버그 계측 원문(javascript_tool 실행 결과 그대로).

# 모드A 반박 — 디버그 계측 원문

`app/web/src/features/practice/PracticeCanvas.tsx`의 루프 진행률 계산 직후(`rawPercent` 산출 직후)에 임시로
```ts
;(window as unknown as { __t28debug?: unknown }).__t28debug = {
  positionSeconds, loopStartSeconds, loopEndSeconds, rawPercent,
}
```
를 추가하고, 실제 Vite dev 서버(5173)+FastAPI(8000)+Claude Browser pane에서 MusicDelta_Grunge를 A-B 루프(마디 1~4) 켠 채 재생하며 `window.__t28debug`와 진행바 DOM의 `style.width`를 같은 `javascript_tool` 호출로 함께 읽었다. 측정 후 이 디버그 코드는 제거했다(커밋에 없음 — `git diff`로 확인, `qa-evidence/T2-8/codex-modeA.md` 참고).

## 측정 1 — 전체 새로고침 직후, 재생 시작 ~2초 경과(카운트인 막 끝남)
javascript_tool 실행 결과 원문:
```json
{
  "domWidths": ["1%"],
  "debug": {
    "loopEndSeconds": 10,
    "loopStartSeconds": 2,
    "positionSeconds": 2.0600453514739243,
    "rawPercent": 0.7505668934240539
  }
}
```
검산: `rawPercent = (positionSeconds - loopStartSeconds) / (loopEndSeconds - loopStartSeconds) * 100 = (2.0600453514739243 - 2) / 8 * 100 = 0.7505668934240539` — 코드의 공식 그대로 재계산해도 정확히 일치(반올림 `Math.round(0.75)=1` → DOM `1%`와 일치).

## 측정 2 — 같은 세션에서 3초 더 경과(루프 구간 중반)
```json
{
  "domWidths": ["47%"],
  "debug": {
    "loopEndSeconds": 10,
    "loopStartSeconds": 2,
    "positionSeconds": 5.7890249433106575,
    "rawPercent": 47.36281179138322
  }
}
```
검산: `(5.7890249433106575 - 2) / 8 * 100 = 47.36281179138322` — 일치. 반올림 `47%` = DOM `47%`와 일치.

## 참고 — 최초 측정에서 "0%에 멈춤"으로 보였던 건
이 두 측정 **이전**, 라이브 코드 편집(HMR) 직후 새로고침 없이 측정했을 때는 `domWidths: ["0%"]`가 몇 초간 계속 나왔다 — 전체 새로고침(`navigate`) 후 재측정하니 위처럼 정상 작동함을 확인, HMR이 남긴 좀비 컴포넌트 인스턴스 때문이었다고 판단(재현을 위해 중간 측정 원문도 `codex-modeA.md`에 요약 인용함).

## 결론
`positionSeconds`·`loopStartSeconds`·`loopEndSeconds`로부터 `rawPercent`를 수동으로 재계산한 값이 디버그 로그의 값과 정확히 일치하고, 그 값이 반올림된 DOM의 실제 진행바 폭과도 일치한다 — **카운트인 오프셋이 루프 경계 계산에 이미 포함돼 있고 정확히 작동함**을 코드 재계산 + 실제 DOM 상태 둘 다로 확정.
