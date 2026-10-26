> 한 줄 요약: T3-16-feedback(음악 스템 MP3 압축) 적용 후에도 맥 원격 재생이 계속 끊겨 네트워크 탭으로 실측 — 범인이 "음악"이 아니라 비압축 상태로 남겨뒀던 stem_drums.wav(38.7MB)였음을 확인(반복·중도취소 Range 요청 패턴). 채보 파이프라인이 읽는 WAV 자산은 그대로 두고, 재생 전용 MP3 사이드카를 추가로 만들어 서빙 엔드포인트가 있으면 우선 쓰도록 수정.

# T3-16-feedback-2(네트워크 스트리밍, drums) QA 결과

## 근거(REQ)
- REQ-04/05. T3-16-feedback(음악 3스템 MP3 압축) 병합 후 의뢰인이 맥에서 재생해보니 여전히 끊김 — "음악은 나오고 있고 노래가 지금도 계속 끊기고 있는 상태" 보고.

## 원인 (Safari 네트워크 탭 실측으로 확인, 추측 아님)
의뢰인이 맥 Safari 웹 속성 관리자의 네트워크 탭을 `stem` 필터로 열어 재생 중 요청 목록을 스크린샷으로 확인:
- `stem_bass`/`stem_other`/`stem_vocals`(이번에 압축한 MP3, 각 5.27MB): 각각 **한 번에** 전체 바이트 범위(`0-5268208`)를 2초 내외로 깔끔하게 받음 — 재요청·취소 없음. **압축이 의도대로 작동함.**
- `stem_drums`(유일하게 WAV로 남겨둔 38.7MB 파일): 같은 파일의 큰 바이트 범위(`0-38707847`, `69310-38666239`, `32964608-38707847`, `33095680-38707847`, `33423360-38707847` 등)를 **반복해서 요청하고 그중 다수가 빨간색(취소됨)**으로 표시됨 — 전형적인 "대역폭이 못 따라가 버퍼링이 끊기고 더 큰/다른 범위로 재요청"하는 thrashing 패턴.

즉 원래 "음악" 채널의 문제라고 짐작했던 끊김의 나머지 부분은, T3-16-feedback에서 "채보 파이프라인 보호"를 이유로 의도적으로 압축하지 않고 남겨둔 바로 그 `stem_drums.wav`가 원인이었음 — 드럼(원곡) 단독으로도 38.7MB는 이 네트워크 경로에서 부담이 됨.

## 변경 내용
1. **`app/server/modules/separator/handler.py`**: `stem_drums.wav`를 기존대로 저장(Asset도 그대로 WAV 가리킴 — 채보 파이프라인 무영향) 한 뒤, **재생 전용 MP3 사이드카**(`stem_drums.mp3`, Asset으로 등록하지 않고 같은 디렉터리에 파일로만 둠)를 `encode_mp3()`로 추가 생성. 이 사이드카 생성은 **best-effort**(try/except) — 실패해도 Song 처리 전체는 COMPLETED로 끝남(재생 최적화일 뿐이라 없으면 그냥 기존 WAV로 서빙됨, 기능 자체는 안 깨짐). 실패 시 `written`과 별도인 `sidecar_written` 리스트로 추적해, 이후 다른 단계가 실패해 정리(cleanup)가 돌 때도 사이드카가 고아 파일로 안 남게 함.
2. **`app/server/api/songs.py`**: `GET /songs/{id}/audio/{kind}`가 등록된 자산이 `.wav`면(현재 stem_drums만 해당) 같은 이름의 `.mp3` 사이드카가 디스크에 있는지 확인 — 있으면 그걸 대신 서빙. `Asset.file_path`(DB)는 전혀 안 바뀜 — 서빙 단계에서만 선택이 갈림.
3. **기존 6개 곡 백필**: `stem_drums.wav` 옆에 `stem_drums.mp3` 사이드카를 생성(원본 WAV는 전혀 안 건드림 — 삭제 없이 추가만 하는 작업이라 T3-16-feedback의 WAV 삭제 백필과 달리 되돌리기 쉬움, 별도 승인 없이 진행). huibigyocha(song=9) 기준: `stem_drums.wav`(38.7MB)는 그대로 있고 `stem_drums.mp3`(5.27MB) 사이드카가 추가됨.

## 변경하지 않은 것
- `Asset` 테이블·`STEM_DRUMS`가 가리키는 파일(WAV)은 전혀 안 바뀜 — T3-2 채보 파이프라인(`librosa.load()`가 WAV를 직접 읽음)은 이번 변경으로 전혀 영향받지 않음(사이드카는 서빙 엔드포인트만 알고, DB/채보 코드는 사이드카의 존재 자체를 모름).

## 위험 분류
서빙 엔드포인트에 "있으면 우선 쓰고 없으면 기존대로" 폴백 로직만 추가 — 기존 동작을 깨지 않는 가산적 변경. 사이드카 생성 실패가 Song 처리 자체를 실패시키지 않도록 명시적으로 격리(테스트로 확인). 오디오 타이밍/동기화 로직 무관 — 모드C 불필요, 모드A만 진행.

## 자동 테스트
```
cd app/server
.venv/Scripts/python.exe -m pytest -q   # 165 passed (이전 162 + 신규 3건)
```
신규:
- `test_separate_handler.py::test_separate_handler_success_creates_four_stem_assets` — drums Asset(WAV) 옆에 `.mp3` 사이드카가 실제로 생기는지 확인하는 어서션 추가.
- `test_separate_handler.py::test_separate_handler_succeeds_even_if_drums_mp3_sidecar_encode_fails` — 사이드카 인코딩이 실패해도 Song.COMPLETED로 끝나고, WAV는 정상·사이드카만 없는지 확인.
- `test_songs_audio.py::test_get_audio_prefers_mp3_sidecar_over_wav_asset` — 사이드카가 있으면 그 내용·`audio/mpeg` Content-Type으로 서빙되는지 확인.
- `test_songs_audio.py::test_get_audio_falls_back_to_wav_when_no_sidecar` — 사이드카 없으면 기존 WAV·`audio/wav`로 서빙되는지 확인(회귀 방지).

## 실데이터 백필 결과
```
song=4  stem_drums.wav(5,292,044) -> stem_drums.mp3(721,649)
song=5  stem_drums.wav(5,292,044) -> stem_drums.mp3(721,649)
song=7  stem_drums.wav(3,528,044) -> stem_drums.mp3(481,532)
song=8  stem_drums.wav(7,383,116) -> stem_drums.mp3(1,006,279)
song=9  stem_drums.wav(38,707,848) -> stem_drums.mp3(5,268,209)   # huibigyocha
song=10 stem_drums.wav(42,817,732) -> stem_drums.mp3(5,827,439)
```
전부 WAV는 그대로 둔 채 사이드카만 추가 생성됨(디스크 확인 완료).

## 브라우저 수동 검증 — 제한적
이전과 동일하게 로그인 자격증명이 없어 실제 재생 화면 검증은 직접 못 함. 서버 테스트·실데이터 백필·사이드카 우선 서빙 로직은 확인 완료. **의뢰인이 맥에서 다시 재생해 드럼(원곡) 포함 전체가 끊김 없이 나오는지 최종 확인 필요.**

## 결론
"음악" 압축만으로는 부족했던 이유를 Safari 네트워크 탭 실측으로 정확히 특정(stem_drums.wav가 범인) — 추측이 아니라 두 번째 라운드도 실제 데이터로 원인을 좁혀나간 사례. 채보 파이프라인을 건드리지 않으면서 재생 성능만 개선하는 "사이드카" 패턴으로 위험 분리.
