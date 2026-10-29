> 한 줄 요약: 라이브러리 "BPM 미상" 버그 수정(음원 업로드 경로에 원곡 BPM 저장 누락) + 연습 화면 BPM 원곡값 재설정 아이콘 추가.

# T3-52 결과

## 배경 (의뢰인 요청, 2026-10-29)
"라이브러리에 이미지를 보면 bpm미상으로 되어있는데 이 값은 우리가 처음
곡 업로드할때 계산해준 값을 적용하면 되. ... 음악연주하는 페이지에 내가
bpm을 임의로 조절하잖아. 근데 원본의 bpm이 몇인지 기억이 안나면 돌아갈
방법이 없다. 여기도 리셋아이콘이 필요해보여."

## 원인 조사(BPM 미상)
`Song.original_bpm`(라이브러리 목록이 읽는 컬럼, `api/songs.py`)은
**디지털 악보 업로드 경로**(`POST /songs`, MIDI/MusicXML/GP)에서만
`parsed.meta.bpm`으로 채워지고 있었다. **음원 업로드 경로**
(`POST /songs/audio` → 분리 → `modules/transcriber/handler.py`의
`transcribe_handler`)는 2026-10-27(Q-40)에 `estimate_tempo()`로 실제
템포를 추정해 `DrumScore.meta.bpm`에는 반영해왔지만(연습 화면 BPM은
정확했음), 그 값을 `Song.original_bpm`에는 한 번도 복사하지 않았던
누락 — 지금은 음원 업로드가 사실상 유일한 주 경로(Phase 4 드롭 후)라
전수 "BPM 미상"으로 보였던 것.

## 구현
- `app/server/modules/transcriber/handler.py` — `estimate_tempo()`로
  구한 `bpm`을 `song.original_bpm`에도 대입(기존 DB 커밋 지점 그대로
  재사용, 추가 커밋 없음).
- `app/server/tests/test_transcribe_handler.py` — 기존
  "estimated tempo가 midi_to_drumscore로 전파되는지" 테스트에
  `song.original_bpm == FIXED_BPM` 단언 추가.
- **일회성 백필**(영구 코드 아님, 스크립트는 세션 스크래치패드에만 존재):
  이미 완료된 기존 3곡(Pretender/YOASOBI/back number)은 수정 전 로직으로
  채보돼 `original_bpm`이 null로 남아있었음 — 같은
  `estimate_tempo(stem_drums_path)`를 한 번 더 실행해 값을 채움(실측:
  Pretender 92.00 / YOASOBI 115.00 / back number 76.00 — back number는
  연습 화면에서 이미 보이던 "BPM 76"과 정확히 일치, 교차 확인됨).
- `app/web/src/features/practice/PracticeCanvas.tsx` — BPM `<label>`
  안, 숫자 입력칸 옆에 재설정 아이콘 추가. 기존 오디오 지연 보정
  재설정 버튼과 완전히 같은 패턴(`.settings-trigger` + `RotateCcw`,
  재생/일시정지 중엔 비활성). 다른 점은 기본값이 고정 0이 아니라
  `score.meta.bpm`(이 곡의 채보 당시 원곡 BPM, 곡마다 다름) — 버튼
  `title`/`aria-label`에 그 값을 그대로 노출해 "뭘로 되돌아가는지"도
  바로 보이게 함.

## 테스트
- `python -m pytest`(백엔드) — 207개 전부 통과.
- `ruff check .` — 에러 없음.
- `npx tsc --noEmit`·`npx oxlint`(프런트) — 에러 없음(기존 경고만).
- `npx vitest run` — 275/275 통과.

## 검증
- 백필 스크립트 실행 로그로 3곡 전부 올바른 BPM 값이 채워짐을 확인(위
  실측값).
- 백엔드 테스트로 "이후 새로 채보되는 곡"도 같은 경로로 채워짐을 보장.
- **브라우저 UI 확인은 못 함** — 서버 재시작으로 로그인 세션이
  끊겼고, 사용자 비밀번호를 모르는 채 로그인을 대신 할 수 없어 라이브러리
  화면에서 직접 "BPM 92/115/76"으로 바뀐 걸 스크린샷으로 남기지는
  못했다(데이터 레벨 확인으로 대체 — 솔직히 명시). BPM 재설정 아이콘도
  같은 이유로 클릭 테스트는 못 함 — 코드가 기존에 이미 검증된 지연보정
  재설정 버튼과 완전히 같은 패턴이라 동작 위험은 낮다고 판단.

## Codex 모드A 검수
1차 `task-mvsvcsq9-c8q7cm` — **REQUEST_CHANGES**(P2): `song.original_bpm =
bpm`을 `song.status = COMPLETED`와 같은 커밋(`staging_path.replace()`
**이전**)에 묶어뒀던 게 문제 — 그 사이 파일 승격(`replace()`)이
실패하면(디스크 꽉 참 등) except 블록이 Song을 FAILED로 되돌려도 이미
커밋된 `original_bpm`은 그대로 남아 "라이브러리 BPM은 새 값인데 실제
DrumScore 파일은 승격 안 된 예전 상태"인 불일치가 생길 수 있었음.
**반영**: `song.original_bpm = bpm` 대입과 커밋을 `staging_path.replace()`
**성공 이후**로 이동(별도 커밋 추가) — 이제 "파일 승격 성공 + BPM 갱신"이
둘 다 성공하거나 둘 다 이전 상태로 남는다. 그 외 지적(디지털 악보
업로드 경로가 재채보로 이어질 수 있는 실제 경로는 없음, 테스트 단언이
`db.refresh` 이후라 실제 DB 상태 검증, BPM 재설정 버튼의 스테일 클로저
없음)은 전부 "문제 없음"으로 확인됨. 수정 후 백엔드 테스트 207개 전부
재통과, ruff 0건.

## 남은 작업
- Codex 모드A 재검수 요청 예정 → APPROVE 후 `main` 병합.
- 의뢰인이 직접 로그인해 라이브러리 BPM 표시·BPM 재설정 아이콘을 눈으로
  확인 필요.
