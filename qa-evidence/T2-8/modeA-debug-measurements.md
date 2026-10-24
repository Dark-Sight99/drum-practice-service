> 한 줄 요약: Codex 모드A의 "A-B 루프 진행바가 카운트인을 반영 안 함" 지적을 반박하기 위해 실제 브라우저에서 캡처한 디버그 계측 값. **출처 한계(Codex 모드B 2차 지적, 솔직히 인정)**: 이 값은 이 세션 중 `javascript_tool` 호출의 응답을 그대로 옮겨 적은 것이고, 브라우저 상호작용 결과를 파일로 자동 내보내는 수단이 이 에이전트에게 없어 이 문서 자체가 그 유일한 기록이다 — 제3자가 독립적으로 재현할 수 있는 로그 파일(타임스탬프·세션ID가 찍힌 별도 export)은 아니다. 아래 "검산"은 **기재된 숫자들이 서로 내적으로 일치하는지**(공식대로 재계산해도 같은 값이 나오는지)를 확인한 것이지, "그 숫자가 실제로 그 순간 브라우저에서 관측됐다"는 것 자체의 독립 증명은 아니다.

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

## 결론(출처 한계를 감안한 표현)
이 세션에서 기록된 값을 기준으로 보면, `positionSeconds`·`loopStartSeconds`·`loopEndSeconds`로부터 `rawPercent`를 수동으로 재계산한 값이 기재된 디버그 값과 내적으로 일치하고, 같은 기록 안에서 DOM 진행바 폭도 그 반올림 값과 일치한다 — 코드가 루프 경계 계산에 카운트인 오프셋을 포함하는 수식 그대로이고(이건 diff로 누구나 독립 확인 가능), 이 세션의 관찰이 그 수식과 모순되지 않는다. "실제로 그 순간 브라우저가 그 값을 보여줬다"는 것 자체는 독립 재현 가능한 로그가 아니라 이 세션의 기록에 근거한다(위 "출처 한계" 참고) — 그래서 모드A의 "P1 버그"라는 주장에 대해서는, 적어도 **코드 자체가 그 버그를 만들 수식이 아니다**라는 점(diff로 확정)과, 이 세션의 관찰이 거기에 부합한다는 점을 근거로 기각한다.
