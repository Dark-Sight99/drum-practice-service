> 한 줄 요약: Codex 모드A 코드 검수 1라운드 — REQUEST_CHANGES(High 2건, Medium 1건, 셋 다 handlePlay()의 비동기 셋업 구간에서 생긴 취소·정리·GET 경쟁 문제). 전부 수정.

# T3-4 Codex 모드A 검수 로그

## 라운드 1 — REQUEST_CHANGES

Target: `main...task/T3-4-mixer` 전체 diff.

Findings:
- **High — GET 불러오기 중 사용자 조작 경쟁**(`PracticeCanvas.tsx`): 저장된 설정을 불러오는(GET) 동안 사용자가 믹서를 조작하면, 뒤늦게 도착하는 GET 응답이 `setMixerState(merged)`로 그 조작을 덮어쓸 수 있었음.
- **High — handlePlay() 셋업 구간의 취소 불가**(`PracticeCanvas.tsx`): `await createDrumVoices()`/`await primePromise` 사이에는 아직 `playbackRef.current`가 없어, 그 틈에 정지를 누르거나 재생을 다시 눌러도 진행 중인 셋업을 아무도 취소·정리하지 못함 — 완료된 뒤에도 취소된 세션의 오디오/트랙이 살아남거나 재생이 시작될 수 있었음.
- **Medium — 셋업 실패 시 리소스 누수**(`PracticeCanvas.tsx`): `createDrumVoices()`가 실패하면 이미 만든 `synthGain`이 안 지워짐. `primePromise`가 실패하는 경우도 voices/metronome/tracks 정리 없이 그대로 reject됨.
- 지적 없음: `mixer.ts`의 솔로/음소거 진리표, 백엔드 API(소유권·낙관적 upsert·부분 갱신), `drumVoices.ts`/`trackPlayer.ts`의 확장.

## 수정
- **GET 경쟁**: `userHasEditedMixerRef` 플래그 추가 — 사용자가 한 번이라도 믹서를 조작했으면(`updateChannel`/`applyDrumlessPreset`에서 세팅) 그 이후의 GET 응답(`.then`/`.catch` 양쪽)은 무시. 사용자의 지금 조작이 항상 이기고, 그 상태는 기존 저장 로직이 알아서 서버에 반영함.
- **셋업 취소 불가 + 리소스 누수**: `playSessionIdRef`(세대 번호) 도입 — `stopPlayback()`이 호출될 때마다(재생 중이 아니어도) 번호를 올려 진행 중인 셋업을 무효화. `handlePlay()`는 시작 시 자기 세대 번호를 기억해뒀다가, `await createDrumVoices()`·`await primePromise` 직후 각각 "내가 아직 최신 세대인지" 확인 — 아니면 그때까지 만든 `tracks`/`synthGain`/`voices`/`metronome`을 전부 정리하고 중단. 셋업 전체를 `try/catch`로도 감싸 생성 중 예외가 나도 같은 정리 함수(`cleanupAbortedSetup`)로 리소스를 해제한 뒤 재발생시킴.

재검증: `pytest` 160개(백엔드 변경 없음, 회귀 확인용 재실행), `vitest` 171개 전부 통과, `oxlint`·`tsc --noEmit` 0건. 실제 브라우저(Chromium)로 **재생 버튼을 연달아 두 번 클릭**(셋업 중 재진입)해 정상적으로 "재생 1개" 상태로 수렴함을 확인(play 비활성화/stop 활성화 — 재생 중 상태 일관됨), 콘솔 에러 없음.

## 결론
모드A 지적 전부 반영 완료. 2라운드 확인 요청 예정.
