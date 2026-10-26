> 한 줄 요약: T3-16-feedback-4(재생 전 프리페치) 이후에도 맥에서 가끔 남는 네트워크 끊김을 더 줄이기 위해, 오디오 서빙 엔드포인트에 장기 불변 캐시(`Cache-Control: immutable`) 헤더를 추가 — 이 song_id/kind 파일은 재분리 엔드포인트가 없어 절대 안 바뀐다는 걸 코드로 확인하고 적용. 프리페치와 합쳐지면 재생 시점엔 네트워크 왕복이 원칙적으로 없어짐.

# T3-16-feedback-5(장기 캐시 헤더) QA 결과

## 근거(REQ)
REQ-04/05. T3-16-feedback-4(프리페치) 적용 후에도 의뢰인이 맥에서 "많이 좋아졌지만 가끔 남는다"고 재확인, 더 개선 요청.

## 원인/배경 (코드로 확인, 추측 아님)
- `GET /songs/{id}/audio/{kind}`(Starlette `FileResponse`)는 기본적으로 `etag`/`last-modified`만 설정하고 `Cache-Control`은 전혀 안 보냄(소스 직접 확인). 즉 브라우저는 캐시된 응답이 있어도 **매번 서버에 재검증(조건부 GET)하러 가야** 함 — 최소한 304 왕복이라도 발생, 이 왕복 자체가 원격(Tailscale) 네트워크에서 끊길 여지가 됨.
- 이 파일이 "안전하게 오래 캐시해도 되는지"를 추측하지 않고 코드로 확인: `app/server/api` 전체에서 `JobType.SEPARATE`를 큐에 넣는 곳은 `upload_audio()`(새 `Song` 생성 시) 딱 한 곳뿐(grep으로 확인) — 기존 곡을 재분리해 같은 파일 경로를 덮어쓰는 엔드포인트 자체가 없음. 즉 한 번 만들어진 `song_id`+`kind` 조합의 오디오 파일은 그 곡이 존재하는 한 **절대 안 바뀜**.

## 변경 내용 (`app/server/api/songs.py`만 수정)
`get_song_audio()`의 `FileResponse`에 `Cache-Control: private, max-age=31536000, immutable` 헤더 추가. `private`(공유 캐시 금지, 로그인한 본인 브라우저에만), `max-age=31536000`(1년), `immutable`(브라우저가 만료 전엔 재검증 요청조차 안 보내도 됨을 명시 — Firefox/Safari가 지원하는 표준 디렉티브).

## 변경하지 않은 것
- 기존 `etag`/`last-modified`(Starlette 기본)는 그대로 유지 — `Cache-Control`만 추가라 캐시 무효화가 필요해지면(예: 나중에 재분리 기능이 생기면) 그때 재검토.
- WAV/MP3 사이드카 선택 로직(T3-16-feedback-2)은 무변경.

## 위험 분류
응답 헤더 추가뿐 — 서빙 로직·Asset 모델·프런트 코드 전부 무변경. 다만 "이 파일이 절대 안 바뀐다"는 전제가 틀리면(향후 재분리 기능이 생기면) 오래된 캐시가 문제될 수 있어, 그 경우 이 헤더부터 재검토해야 함을 기록해둠(이번 작업 범위 밖, 현재는 재분리 기능 자체가 없어 안전).

## 자동 테스트
```
cd app/server
.venv/Scripts/python.exe -m ruff check api/songs.py tests/test_songs_audio.py   # 통과
.venv/Scripts/python.exe -m pytest -q   # 166 passed (신규 1건 포함)
```
신규: `test_songs_audio.py::test_get_audio_sets_long_lived_immutable_cache_control` — 응답의 `cache-control` 헤더가 정확히 `private, max-age=31536000, immutable`인지 확인.

## 브라우저 수동 검증 — 제한적
백엔드를 재시작해 최신 코드가 반영된 상태 확인(프로세스 재시작, `curl`로 라우팅 정상 확인). 로그인 자격증명이 없어 실제 네트워크 탭에서 캐시 적중·재생 중 네트워크 요청이 사라졌는지는 직접 확인 못함 — **의뢰인이 맥에서 재생 중 네트워크 탭에 새 요청이 전혀 안 뜨는지, 끊김이 더 줄었는지 확인 필요.**

## 결론
T3-16-feedback-4(프리페치)가 "미리 받아둔다"는 것만 보장했다면, 이번 변경은 "한 번 받으면 다시 안 물어봐도 된다"는 것까지 보장해 둘을 합치면 재생 시점엔 원칙적으로 네트워크 요청이 전혀 없어야 함. 그래도 끊기면(브라우저 캐시 자체가 날아간 경우 등) 남은 네트워크 불안정은 애플리케이션 레이어로는 더 손댈 여지가 거의 없는 수준으로 판단.
