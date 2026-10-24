> 한 줄 요약: Demucs가 ffmpeg를 거쳐 mp4(동영상) 파일에서도 오디오를 바로 추출해 분리할 수 있음을 실제 의뢰인 파일로 확인. 단, 업로드 API 자체는 계획대로 mp4를 허용 확장자에 넣지 않음(REQ-01 범위 밖, `work/T3-1/plan.md` §가정 참조) — 이 결과는 Separator 모듈 자체의 동작 가능성 확인용.

# Demucs + ffmpeg mp4 입력 스파이크(2026-10-25)

## 배경
의뢰인이 Phase 3 테스트용 실제 음원을 `음원/`(루트, `.gitignore` 대상) 폴더에 mp4 형식으로 제공. REQ-01은 mp3/wav/m4a/flac만 명시하지만, Demucs의 `AudioFile` 클래스가 ffmpeg를 통해 모든 ffmpeg 지원 포맷을 읽는 구조임을 설치된 버전(4.1.0) 소스 코드로 확인했었음(`.venv/Lib/site-packages/demucs/audio.py` docstring: "Allows to read audio from any format supported by ffmpeg") — 단, 이 PC엔 ffmpeg이 PATH에 없었음(세션 중 winget으로 설치).

## 실행
```
winget install --id Gyan.FFmpeg -e
# (PATH 반영 전이라 이번 세션에선 바이너리 경로를 직접 PATH에 추가해 사용)
python -m demucs -n htdemucs -d cuda -o <out> "음원/pretender.mp4"
```

## 결과
- 종료 코드 0, 에러 없음.
- 실제 처리 시간: **18.3초**(wall clock), 입력 길이 **315.9초(5.27분)** → 약 17.3배속(RTX 5060, T0-1의 10.36배속보다 빠름 — 입력이 순수 오디오가 아니라 비디오 컨테이너라는 점 외엔 처리 자체는 동일 오디오 데이터라 배속 차이는 GPU 워밍업·곡 내용물 차이로 추정, 추가 검증 안 함).
- 4개 트랙(drums/bass/vocals/other) 전부 생성됨 — 표준 라이브러리 `wave` 모듈로 직접 헤더 검사: 44100Hz, 스테레오(2ch), 315.24초(원본과 거의 일치, 디코딩 경계 오차 0.7초 미만) — 유효한 재생 가능 WAV 파일로 확인.

## 결론
Demucs(ffmpeg 백엔드)는 mp4 동영상에서 오디오를 바로 추출해 정상 분리할 수 있음을 실제 파일로 확인. 다만 `work/T3-1/plan.md`의 설계 결정대로, **공개 업로드 API(`POST /songs/audio`)의 허용 확장자 목록에는 mp4를 넣지 않는다**(REQ-01이 mp3/wav/m4a/flac만 명시, 명시 안 된 입력 형식 확장은 범위 밖 작업 — CLAUDE.md 절대규칙 6). 이번 확인은 Separator 모듈 자체(Demucs 호출부)가 다양한 입력에 견고함을 미리 검증해둔 것뿐.

## 재현/정리
결과 WAV 4개(약 213MB, 의뢰인의 저작권 있는 음원 유래 파생물)는 재현 가능한 산출물이라 커밋하지 않고 삭제함(원본 mp4도 `음원/.gitignore` 대상, 커밋 안 됨 — CLAUDE.md §6 "개인 연습용으로만 처리, 외부 전송 안 함" 원칙).
