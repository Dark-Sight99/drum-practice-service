> 한 줄 요약: 의뢰인이 맥에서 Tailscale 원격 접속으로 "음악(베이스·보컬·그 외)" 채널만 끊기는 걸 재현 — 3개 WAV 스템(각 38.7MB, 동시 재생)을 원격 네트워크로 스트리밍하는 게 원인으로 확인, bass/vocals/other만 MP3(192kbps)로 압축 저장하도록 변경(drums는 채보 파이프라인이 직접 읽어 WAV 유지). 기존 6개 곡도 백필 완료.

# T3-16-feedback(네트워크 스트리밍) QA 결과

## 근거(REQ)
- REQ-04/REQ-05 다중 트랙 동기 재생·믹서. T3-16 병합 후 의뢰인이 맥(Tailscale 원격 접속)에서 재측정하다 "음악(베이스·보컬·그 외)" 채널만 심하게 끊기는 걸 발견 — 드럼(원곡)·신스드럼·메트로놈은 안 끊김.

## 원인 (실측으로 확인)
- `PracticeCanvas.tsx`의 "음악" 슬라이더 하나가 실제로는 `stem_bass`/`stem_vocals`/`stem_other` **3개의 개별 `<audio>` 엘리먼트를 동시 재생**(`MUSIC_STEM_KEYS`) — UI에 개별 조절 기능 자체가 없어 항상 셋이 같이 켜짐.
- 디스크에서 실제 파일 크기 확인(huibigyocha, song id=9): `stem_drums.wav`/`stem_bass.wav`/`stem_other.wav`/`stem_vocals.wav` 전부 **38,707,848바이트(38.7MB, 비압축 WAV)**로 동일.
- "음악"은 드럼(원곡) 1개(38.7MB)의 **3배(약 116MB)**를 Tailscale 원격 터널로 동시에 받아야 함 — 네트워크 대역폭이 못 따라가 끊김으로 추정(드럼(원곡)은 같은 네트워크에서 안 끊기므로 "WAV라서"가 아니라 "3배라서"가 핵심).

## 변경 내용
1. **`app/server/modules/separator/demucs_separator.py`**: `encode_mp3(wav_path, bitrate_kbps=192)` 신규 — `imageio-ffmpeg`가 pip wheel에 번들로 포함하는 ffmpeg 바이너리(`libmp3lame` 인코더 포함, 직접 실행해 `-encoders` 출력으로 확인)로 WAV를 MP3로 인코딩. 시스템 PATH의 ffmpeg에 의존하지 않음(`Get-Command ffmpeg`로 이 PC에 PATH 등록 안 돼 있음을 확인했던 전력 있음).
2. **`app/server/modules/separator/handler.py`**: `separate_handler()`가 stem을 저장할 때 `drums`만 기존처럼 `.wav` 그대로 저장(T3-2 채보 파이프라인이 `librosa.load()`로 이 파일을 직접 읽으므로 손대지 않음 — MP3로 바꾸면 디코더가 바뀌어 채보 정확도에 영향 줄 위험이 있고, 애초에 drums는 끊김 문제가 없어서 바꿀 이유도 없음), `bass`/`other`/`vocals`는 `encode_mp3()`로 압축해 `.mp3`로 저장.
3. **기존 6개 곡 백필**: 이미 분리돼 있던 곡(song id 4,5,7,8,9,10)의 `stem_bass/other/vocals.wav` 18개를 전부 MP3로 재인코딩해 저장하고 `Asset.file_path`를 갱신, 원본 WAV 삭제(의뢰인 승인, 2026-10-26). huibigyocha(id=9) 기준: 38.7MB×3=116MB → 5.27MB×3≈15.8MB(약 **7.3배** 축소) — 드럼(원곡) 1개(38.7MB, 끊기지 않던 채널)보다도 훨씬 작아짐.
4. **라이선스**: `imageio-ffmpeg` 패키지 자체는 BSD-2-Clause지만, 번들 ffmpeg 바이너리는 직접 실행해 빌드 설정(`--enable-gpl --enable-version3`)을 확인한 결과 **GPLv3**. `intent/03-architecture-stack.md` 라이선스 표에 기록, 의뢰인 승인 받음(2026-10-26, 개인 사용 단계는 진행·상업 배포 전 재검토 조건).
5. `app/server/requirements.txt`에 `imageio-ffmpeg` 추가.

## 변경하지 않은 것(의도적으로 범위 제한)
- 3스템을 하나로 믹싱하는 건 하지 않음(클리핑 위험이 있고, 압축만으로도 충분히 해결될 것으로 추정 — 드럼원곡(38.7MB, 안 끊김)보다 더 작아졌으므로 근거 있는 추정). 안 끊기면 이대로 종료, 그래도 끊기면 믹싱 추가 검토.
- `stem_drums`는 포맷 그대로(WAV) — 채보 파이프라인 영향 없음.

## 위험 분류
서버 저장 포맷 변경 + 기존 데이터 마이그레이션(파일 삭제 포함) — 되돌릴 수 없는 작업이라 백필 실행 전 의뢰인 승인 받음. `GET /songs/{id}/audio/{kind}`(`api/songs.py`)는 `mimetypes.guess_type(path.name)`으로 확장자 기반 Content-Type을 이미 정하고 있어 코드 수정 불필요(실제로 안 건드림) — 확인만 함. `Asset.file_path`에 확장자 제약(CheckConstraint)이 없음을 `db/models.py`에서 확인. 오디오 타이밍/동기화 로직은 전혀 안 건드려 모드C 불필요, 모드A만 진행.

## 자동 테스트
```
cd app/server
.venv/Scripts/python.exe -m pytest -q   # 162 passed (전체 스위트, 신규 encode_mp3 테스트 포함)
```
- `tests/test_demucs_separator.py`: `encode_mp3()` 커맨드 조립·에러 처리 신규 테스트 2건(subprocess monkeypatch).
- `tests/test_separate_handler.py`: drums=`.wav`, bass/other/vocals=`.mp3`로 저장되는지 확장자 검증 추가, 부분 실패 시 정리 로직 테스트도 새 확장자(`stem_bass.mp3`)에 맞게 갱신.

## 실제 데이터로 직접 검증(모킹 아님)
```
encode_mp3(data/songs/9/stem_bass.wav) 실행 → 5,268,209바이트 반환
ffmpeg -i로 원본 WAV vs 인코딩된 MP3 비교:
  원본: Duration 00:03:39.43, pcm_s16le, 44100Hz, stereo, 1411kb/s
  MP3:  Duration 00:03:39.48, mp3(libmp3lame 인코딩), 44100Hz, stereo, 192kb/s
  (길이 차이 0.05초는 MP3 인코더의 알려진 프라이밍 지연 — 정상)
```
실제 huibigyocha 파일로 인코딩→디코딩까지 왕복 확인, 가짜 데이터가 아님.

## 브라우저 수동 검증 — 제한적
이 세션(Claude의 내장 브라우저)에 로그인 자격증명이 없어(의뢰인 본인만 아는 계정) 실제 재생 화면에서 끊김 해소 여부는 직접 확인하지 못함. 대신:
- 서버 API 라우팅 확인: `GET /api/songs/9/audio/stem_bass`가 (인증 없이) 401을 정상 반환 — 라우팅·프록시 정상 동작.
- DB·디스크 상태 직접 확인: `assets` 테이블의 `file_path`가 `9/stem_bass.mp3` 등으로 갱신됨, 디스크에 `stem_drums.wav`만 남고 나머지는 `.mp3`로 존재.
- **의뢰인이 직접 맥에서 재생해 "음악" 채널 끊김이 실제로 없어졌는지 재확인 필요** — 이게 최종 확인.

## 결론
"음악" 채널이 드럼(원곡) 대비 3배 분량의 비압축 WAV를 동시 스트리밍하던 게 원인이라는 가설을 실제 파일 크기로 뒷받침해 압축으로 대응. 믹싱(클리핑 위험 있음)은 보류하고 압축만 우선 적용 — 드럼(원곡)보다도 작아졌으므로 해결될 가능성이 높다고 보지만, 최종 확인은 의뢰인의 실제 재생 테스트로.
