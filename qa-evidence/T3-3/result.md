> 한 줄 요약: T3-3(REQ-04) 구현 완료 — 분리 스템 서빙 API(Range 지원)+`trackPlayer.ts`(모바일 제스처 언락·언락 실패 추적)+`scorePlayer.ts` Transport 동기화(모드C 1라운드에서 잡힌 루프 위치 버그 수정 반영)+`PracticeCanvas` 연동. 자동 테스트·실제 브라우저(Chromium, 백엔드+프런트 dev 서버)로 재생/정지/재재생까지 확인했지만, **±30ms 수용 기준 충족 여부는 아직 확인 안 됨**(실기기+교차상관 분석 필요, work/T3-3/plan.md §5·§QA계획 3에서 처음부터 명시한 대로 미리 주장하지 않음).

# T3-3 결과 — 다중 트랙 동기 재생 + 음정 유지 속도 변경

## 설계
`work/T3-3/plan.md` — Codex 모드C 3라운드(1·2라운드 REQUEST_CHANGES 반영, 3라운드 APPROVE). 설계 단계에서 실제 버그 1건(루프 재진입 시 오디오 위치가 항상 0으로 틀리던 것)이 모드C 1라운드에서 발견돼 구현 전에 수정됨.

## 구현
- **백엔드**: `GET /songs/{song_id}/audio/{kind}`(`app/server/api/songs.py`) — `AudioAssetKind`(`db/models.py`의 `AUDIO_ASSET_KINDS`에서 자동 생성, DRUMSCORE_*·SHEET_IMAGE·MIDI_EXPORT는 못 들어와 422), 기존 `get_owned_song`/`resolve_asset_path` 재사용, `FileResponse`로 Range 응답. `Song.available_audio_kinds`(새 프로퍼티) → `SongOut.available_audio_kinds`.
- **프런트**: `app/web/src/audio/trackPlayer.ts`(신규, `HTMLAudioElement` 래퍼 — 트랙별 언락 성공/실패를 세션 동안 고정 보관, 실패 트랙은 재시도 없이 계속 건너뜀), `timing.ts`의 `audioTrackPositionSeconds()`(순수 동기화 수식), `scorePlayer.ts` 확장(루프 재진입 포함 1회 스케줄로 오디오 시작/재진입 트리거), `PracticeCanvas.tsx` 연동(`songId`/`availableAudioKinds` prop, `audioOffsetMs≠0` 가드, `original` 제외 — 아래 "구현 중 발견한 버그" 참조, 저빈도 리싱크).

## 구현 중 발견한 버그(자체 수정, 구현 직후 실제 브라우저 테스트로 발견)
설계 문서(§범위경계)는 "original은 T3-3에서 제외, 스템 4종만"이라고 명시했는데, 실제로 `PracticeCanvas.handlePlay()`를 짰을 때 `availableAudioKinds`(백엔드가 주는 범용 목록, `original` 포함)를 필터링 없이 그대로 썼다 — 설계와 어긋나는 구현 버그. 실제 브라우저로 재생해보고 네트워크 탭에서 직접 확인(아래 "실제 브라우저 확인" 참조)하기 전에 코드 리뷰로 먼저 발견해 `stemKinds = availableAudioKinds.filter(k => k !== 'original')`로 수정.

## 자동 테스트
- 백엔드: `pytest` 150개 전부 통과(기존 141 + 신규 9: 소유권/존재/Range/kind 제한), `ruff check` 0건. (`pytest_output.txt`, `ruff_output.txt`)
- 프런트: `vitest` 150개 전부 통과(기존 138 + 신규 12: `audioTrackPositionSeconds` 6개 — 루프 재진입 회귀 포함, `trackPlayer.ts` 6개 — 언락 성공/부분실패/건너뛰기/stop/dispose, `HTMLMediaElement.prototype.play/pause`를 직접 mock해 jsdom이 재현 못 하는 성공/실패 분기를 통제), `oxlint` 0건, `tsc --noEmit` 0건. (`vitest_output.txt`, `oxlint_output.txt`, `tsc_output.txt`)

## 실제 브라우저 확인(Chromium, 로컬 백엔드+Vite dev 서버, 실제 분리된 곡 "backnumber" 사용)
1. 라이브러리 → backnumber 연습 화면 진입 — 콘솔 에러 없음.
2. `GET /api/songs`로 `available_audio_kinds: ["original","stem_bass","stem_drums","stem_other","stem_vocals"]` 실제 응답 확인(네트워크 탭에서 직접 읽음).
3. ▶ 재생 클릭 → 네트워크 탭에서 **`stem_bass`·`stem_drums`·`stem_other`·`stem_vocals` 4개만** 요청됨(`original` 제외 확인) — 전부 **206 Partial Content**(Range 요청이 실제로 동작함, 소스만 읽어본 게 아니라 실제 응답으로 확인). 콘솔 에러 없음(모바일 제스처 언락이 데스크톱 Chromium에서는 거부 없이 전부 성공했다는 뜻 — 모바일 Safari 특유의 거부는 이 환경에서 재현 안 됨, 아래 "한계" 참조).
4. 재생 3초 경과(첫 리싱크 폴링 주기 750ms를 지남) — 콘솔 에러 없음.
5. ⏹ 정지 → 콘솔 에러 없음.
6. 다시 ▶ 재생(재재생, `TrackPlayer` 생명주기 확인) → 4개 스템 요청이 다시 발생(새 `TrackPlayer` 인스턴스가 만들어짐 확인), 콘솔 에러 없음. 일부 요청이 `net::ERR_ABORTED`로 표시됐으나(네트워크 탭), 이는 `prime()`의 "play()+즉시 pause()+currentTime=0" 이후 `playFrom()`이 다시 seek·재생하면서 이전 범위 요청이 자연스럽게 취소되는 것으로 해석됨(브라우저의 정상적인 미디어 스트리밍 동작 — 콘솔에 에러로 안 뜨고 재생 자체도 멈추지 않음, 코드의 `.catch()`가 이런 거부를 이미 흡수함).

## Codex 모드A 1라운드(Fail → 수정)
`resync()`가 `currentTime`(이미 원곡 파일 기준 초)에 `playbackRate`를 중복 적용하던 실제 버그(Medium) 발견 — 1배속에서는 숨겨져 있어 이번 result.md 작성 시점의 브라우저 확인(기본 100%)에서는 못 잡았던 것. `resync()` 시그니처에서 `playbackRate`를 제거해 버그 자체를 없애고, 약했던 테스트(예외만 확인)를 `currentTime` setter 스파이로 실제 값 검증하도록 재작성. 수정 후 **연습 BPM 60(원곡 120의 50%)**으로 다시 브라우저에서 재생해 리싱크 폴링 주기를 여러 번 지나도 콘솔 에러 없음을 확인(1배속만 테스트했던 앞의 확인을 보강). 전체 로그: `codex-modeA.md`.

## 한계·미확인(숨기지 않음, work/T3-3/plan.md와 일관)
- **±30ms 수용 기준(REQ-04)은 아직 측정 안 됨.** 이번 확인은 "에러 없이 돌아간다"까지이고, T2-11 때처럼 실제 재생을 녹화해 교차상관 분석을 해야 오디오-메트로놈/레인 어긋남을 숫자로 알 수 있다. §5에서 쓴 리싱크 threshold(80~100ms 상당, 코드 상수는 0.1초/750ms)도 이 측정 전까지는 추정치일 뿐 — 구현 완료가 "±30ms 충족"을 의미하지 않는다.
- **모바일 제스처 언락(§3)은 데스크톱 Chromium에서만 확인.** iOS Safari 특유의 "새 `<audio>` 엘리먼트 거부" 패턴(T0-5가 실측)은 이 환경에서 재현되지 않으므로, 실제 아이폰/아이패드로 재확인 필요.
- **A-B 루프 경계에서 오디오·MIDI 상대 타이밍**(§4, 모드C 1라운드 MAJOR)도 청각적으로 체감되는지까지는 이번 브라우저 확인에 포함 안 됨(루프 기능 자체를 이번 라운드에서 켜보지 않음) — 다음 확인 항목.
- 위 셋 모두 실기기·실제 분리 오디오로 하는 end-to-end 측정이 필요해 사용자의 직접 테스트(또는 그에 준하는 별도 작업)로 이어감.

## 재현
```
cd app/server && .venv/Scripts/python.exe -m pytest -q && .venv/Scripts/python.exe -m ruff check . --exclude .venv
cd ../web && npm test && npm run lint && npx tsc --noEmit
```
브라우저 확인: 백엔드+`npm run dev` 기동 후 로그인 → 분리된 곡(스템 존재) 연습 화면 → 재생/정지/재재생, 네트워크 탭에서 `/songs/{id}/audio/{kind}` 요청 확인.
