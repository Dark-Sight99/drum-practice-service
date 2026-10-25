> 한 줄 요약: T3-4 게이트 피드백 3차(베이스/보컬/기타 악기를 "음악(전체)" 슬라이더 하나로 묶음) — 테스트/타입체크/린트 통과 + 브라우저 저장·재로드·재생 확인 완료.

# T3-4-feedback-3 QA 결과

## 근거(REQ)
- REQ-05 트랙별 볼륨
- 의뢰인 피드백(2026-10-25, 대화 로그): "음악자체 볼륨도 컨트롤 할 수 있어야겠는데 음악소리가 드럼에 비해 너무 크다" → 명확화 질문에 "베이스 보컬 기타악기 하나로 묶어서 좋다"로 확인.

## 변경 내용
1. `app/web/src/audio/mixer.ts` — `MUSIC_STEM_KEYS`(`stem_bass`/`stem_vocals`/`stem_other`) 상수와 `musicVolume`/`isMusicMuted`/`isMusicSolo`/`setMusicVolume`/`setMusicMuted`/`setMusicSolo` 순수 함수 신설. 저장되는 `MixerState`(6채널 각각의 volume/muted/solo)는 그대로 — 이 함수들이 3채널에 같은 값을 한꺼번에 쓸 뿐이라 백엔드 스키마·`effectiveGain()` 전부 무수정.
2. `app/web/src/audio/index.ts` — 위 함수들 barrel export 추가.
3. `app/web/src/features/practice/PracticeCanvas.tsx` — 믹서 행 렌더링을 `MixerRow` 컴포넌트로 추출(기존 `CHANNEL_KEYS.map()` 안 JSX를 재사용 가능하게 분리), `MIXER_ROW_KEYS = ['stem_drums','synth_drums','metronome']`로 개별 행은 3개만 남기고, `stem_drums` 바로 다음에 "음악(베이스·보컬·기타)" 묶음 행을 끼워 넣음. `updateMusicVolume`/`updateMusicMuted`/`updateMusicSolo` 핸들러 신설(기존 `updateChannel`과 같은 패턴 — 편집 플래그·디바운스 저장 재사용).

## 설계 판단
- 위험 분류: 순수 레이아웃·UI 묶음 변경(백엔드/데이터 구조/오디오 타이밍 로직 무수정) — T3-4-feedback-1/2와 같은 기준으로 Codex 모드C 불필요, 모드A만 진행.
- "음악(전체)" 슬라이더가 보여줄 대표값은 3채널 평균(`musicVolume`) — 슬라이더를 한 번이라도 움직이면 `setMusicVolume`이 3채널을 전부 같은 값으로 맞춤. M/S도 "전부 켜져 있을 때만 체크 표시"(`isMusicMuted`/`isMusicSolo`)로 — 섞인 상태(예: 레거시 저장값)에서 클릭하면 3채널이 같은 값으로 정규화됨.

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 189 tests 모두 통과(기존 179 + mixer.ts 신규 10)
npm run lint            # oxlint 통과, 경고 없음
```

## 브라우저 수동 검증 (localhost:5174, 로그인된 세션, huibigyocha 곡)
- 믹서에 "드럼(원곡)·음악(베이스·보컬·기타)·신스 드럼·메트로놈" 4행만 표시되는 것 확인(기존 6행에서 베이스/보컬/기타 3개가 1개로 묶임).
- "음악" 슬라이더를 40%로 옮기자 즉시 40%로 표시 변경 → 페이지 새로고침 후 재진입해도 40%가 그대로 유지됨(서버에 저장된 베이스/보컬/기타 3채널이 모두 0.4로 저장됐다는 뜻 — 평균 표시값과 일치).
- "음악" 행의 M(음소거) 체크 → 체크됨 + 행이 흐려짐(3채널이 함께 음소거됐다는 시각 확인) → 다시 해제해 원상복구.
- 볼륨을 100%로 복원 후 재생 → 콘솔 에러 0건(기존 믹서 게인 적용 로직이 묶음 UI 변경에 영향받지 않음 확인).

## 결론
베이스/보컬/기타 악기를 "음악(전체)" 슬라이더·M·S 하나로 묶는 요청 구현·검증 완료. 회귀 없음(기존 189개 테스트 전부 통과, 저장/재생 경로 동작 확인).
