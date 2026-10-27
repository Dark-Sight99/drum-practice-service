> 한 줄 요약: 홈서버형 PWA 구조(집 PC = 처리·저장 서버, 모든 기기 = 브라우저)와 기술 스택·라이선스. ⚠ 표시는 Phase 0에서 검증할 항목.

# 03. 아키텍처 & 기술 스택

## 1. 선택한 구조: 홈서버형 웹앱 (A안)
검토한 대안: B. 브라우저 단독(폰에서 분리 불가, 동기화 없음) / C. 클라우드 GPU(월 비용, 목표 대비 과함). → A 채택.

```
[폰/태블릿/PC 브라우저 — PWA]
  ├ 연습 화면(레인+킷), 오디오 엔진, 메트로놈, 편집기, 라이브러리 UI
  ├ 오프라인 캐시(Service Worker + IndexedDB)
  │
  │ HTTPS (Tailscale 사설망 또는 터널)
  ▼
[집 PC — 처리 서버]
  ├ API 서버 (FastAPI)  ── 인증, 라이브러리, 파일 제공
  ├ 작업 워커 (별도 프로세스) ── 분리 / 채보 / 변환
  ├ SQLite (메타데이터, 작업 큐)
  └ 파일 저장소 (data/songs/<song_id>/...)
```

### 설계 원칙 (업계 표준 패턴)
- **UI와 무거운 연산 분리**: Electron의 메인/렌더러 분리와 같은 원칙을 웹에 적용 — 무거운 연산은 서버 워커 프로세스로, 브라우저 내부 연산(파싱, 오디오 처리)은 Web Worker/AudioWorklet으로.
- **교체 가능한 모듈**: `Separator`, `DrumTranscriber`, `ScoreImporter` 인터페이스. 구현체 교체만으로 모델 변경. (~~`ScoreRecognizer(OMR)`~~ — 2026-10-26 종이 악보 경로 드롭으로 불필요, `intent/01-vision.md` "2026-10-26 갱신" 참고)
- **단일 내부 형식 DrumScore**: 모든 입력이 이 형식으로 수렴, 모든 화면이 이 형식만 읽음.
- **단일 마스터 클록**: 오디오 컨텍스트 시간을 기준으로 레인·메트로놈·MIDI 소리 스케줄링(REQ-11 대비).

## 2. DrumScore (내부 형식, JSON)
```json
{
  "version": 1,
  "meta": { "title": "", "bpm": 120, "timeSignature": [4, 4], "source": "audio|midi|musicxml|gp" },
  "notes": [ { "tick": 0, "piece": "kick", "velocity": 100, "hand": "RF", "handSource": "auto|user" } ],
  "ppq": 480,
  "audioOffsetMs": 0
}
```
- `piece` 값과 General MIDI 타악기 번호 매핑표를 코드 상수로 둔다(예: kick=36, snare=38, hihat_closed=42, hihat_open=46, crash=49, ride=51, tom_high=50, tom_mid=47, tom_floor=43). 근거: General MIDI Level 1 Percussion Key Map — 구현 시 공식 표로 재확인.
- `audioOffsetMs`: 오디오와 MIDI 시작점 정렬값(편집기에서 조정 가능).
- `hand`: `R|L|RF|LF|null` (REQ-12). `handSource`가 `user`인 값은 자동 추천이 절대 덮어쓰지 않는다. MIDI 내보내기 시 손 정보는 표준 필드가 없으므로 DrumScore에만 보존.

## 3. 기술 스택
| 영역 | 선택 | 이유 | 상태 |
|---|---|---|---|
| 프론트 | React + TypeScript + Vite | 생태계·AI 코드 생성 안정성 | |
| PWA | vite-plugin-pwa (Workbox) | 오프라인 캐시 | |
| 렌더링 | Canvas 2D (성능 부족 시 PixiJS) | 레인 60fps | ⚠ 폰 성능 측정 |
| 오디오 엔진 | Web Audio API, 스케줄링·메트로놈은 Tone.js | 정확한 타이밍 | |
| 음정 유지 속도 변경 | **HTMLMediaElement `preservesPitch`** 채택 확정(2026-10-23, 의뢰인 승인). SoundTouch AudioWorklet은 실기기(iPhone 13 Pro·iPad mini 5) 테스트에서 오디오 엔진이 간헐적으로 수 초씩 밀리는 현상 확인돼 제외 | | Q-04 해소됨, 상세는 `qa-evidence/T0-5/result.md` |
| MIDI 입출력 | @tonejs/midi | | |
| GP/MusicXML 가져오기 | alphaTab (MPL-2.0) | `ScoreLoader.loadScoreFromBytes` → `MidiFileGenerator`+`AlphaSynthMidiFileHandler` → `MidiFile.toBinary()`로 표준 MIDI 바이트를 뽑아 @tonejs/midi로 재파싱(퍼커션 채널9·GM 노트번호 전부 실제 MusicXML 파일로 실검증, `work/T2-1/plan.md`) | T0-3/T0-4의 실제 `.musicxml`/`.mxl` 샘플로 검증됨. GP(.gp/.gp3~5/.gpx)는 같은 API를 쓰지만 실제 GP 샘플로는 검증 못함 |
| UI 아이콘 | lucide-react (ISC, 확인됨 2026-10-27) | 08-design.md 지정, npm 패키지로 설치(T3-25) | |
| UI 폰트 | Pretendard (SIL OFL ⚠확인) | 08-design.md 지정, 자체 호스팅 | ⚠ 라이선스 확인 |
| 백엔드 | Python 3.11+ / FastAPI / Uvicorn | ML 모델이 Python | |
| 작업 큐 | SQLite 테이블 기반 자체 워커(별도 프로세스) | Redis 불필요, 윈도우·맥 동일 | |
| DB | SQLite | 단일 사용자, 백업 쉬움 | |
| 인증 | 비밀번호 해시(argon2 또는 bcrypt) + HttpOnly 세션 쿠키 | | |
| 분리 | Demucs htdemucs (PyTorch), device 자동 선택 cuda→mps→cpu | MIT | ⚠ 현재 유지 저장소·설치 방법 확인 |
| 드럼 채보 | ADTOF (1순위), 대안 조사 포함 | | ⚠ NC 라이선스, 실행 환경 확인 |
| ~~OMR~~ | ~~Audiveris (Java, CLI 배치 모드) → MusicXML~~ | | **드롭(2026-10-26, 의뢰인 결정)** — 종이 악보 경로 자체를 안 만듦, 둘 다 미구현 상태에서 드롭(설치도 안 됨). `intent/01-vision.md` "2026-10-26 갱신" 참고 |
| ~~PDF → 이미지~~ | ~~pypdfium2(Apache-2.0/BSD-3-Clause, 2026-10-23 채택 확정했었음)~~ | | **드롭(2026-10-26)** — 위와 같은 사유, OMR 전용 용도였음 |
| 원격 접속 | Tailscale | 개인 무료 플랜(최대 6명, 비상업)으로 확정(2026-10-23). 지인은 Tailscale 네트워크 초대로 접속. Funnel(링크 공개) 포함 여부는 참고 조사(Q-13), 채택 여부는 별도 결정 | 사용자 설치 필요 |
| 테스트 | Vitest, Playwright(스크린샷 증거), pytest | | |

### 서버 PC 후보
| | 윈도우 (RTX 5060) | 맥 (M1) |
|---|---|---|
| 분리 가속 | CUDA. PyTorch **CUDA 12.8 이상 빌드 필수**(Blackwell sm_120) | MPS 또는 CPU. 모델에 따라 MPS가 CPU보다 느린 사례 있음 |
| 사용 패턴 | 의뢰인이 낮 시간 내내 사용(작업·게임). 개발도 이 PC에서 진행 | 거의 안 씀. 외출 작업 시에만 들고 나감 |
| 결정 방법 | Phase 0에서 같은 3~4분 곡으로 분리·채보 시간 측정 → 사용자 결정 | |

**현재 방침 (의뢰인 합의 전 기본값)**: MVP 기간에는 **윈도우 PC = 개발 PC = 서버**. 개발·테스트를 한 대에서 하고, GPU가 가장 빠르기 때문. 단, 아래를 지킨다:
- 무거운 작업은 업로드할 때만 실행하고, 평소에는 대기 상태(유휴 부하 최소)
- 워커는 GPU 작업을 한 번에 1개만 처리. 설정에서 "CPU 전용 모드"와 "작업 일시정지"(게임 중) 제공
- 서버는 사용자 로그인 시 자동 시작. 수동 시작·중지 스크립트 제공(T5-4)
- 서버 코드·데이터 폴더는 맥으로 그대로 옮길 수 있게(경로 하드코딩 금지, `data/` 폴더 통째 복사로 이전 가능)
- 코드는 두 OS 모두에서 동작해야 한다(경로는 `pathlib`, 셸 스크립트는 PowerShell/zsh 양쪽 제공 또는 Python 스크립트로).

## 4. 라이선스 표
| 구성요소 | 라이선스 | 개인 사용 | 상업 공개 시 |
|---|---|---|---|
| Demucs | MIT | 가능 | 가능(고지) |
| ADTOF | CC BY-NC-SA 4.0 | 비상업 범위 내 가능(지인 포함 소수 사용자 재검토 중, Q-14) | **불가 → 교체 필요** |
| Audiveris | AGPL-3.0 ⚠확인 | 지인 포함 소수 사용자 네트워크 서비스 시 소스 공개 의무 재검토 중(Q-14) | 서버 제공 시 소스 공개 의무 검토 |
| alphaTab | MPL-2.0(확인됨, 2026-10-23, npm 레지스트리 `license` 필드) | 가능 | 가능(조건부) |
| @tonejs/midi | MIT(확인됨, 2026-10-23, npm 레지스트리 `license` 필드) | 가능 | 가능(고지) |
| tone(Tone.js) | MIT(확인됨, 2026-10-23, npm 레지스트리 `license` 필드) — T2-2에서 빠뜨렸다가 T2-2b에서 기록 | 가능 | 가능(고지) |
| Virtuosity Drums(드럼 샘플) | CC0(확인됨, 2026-10-23, 공식 페이지 "open source (Creative Commons 0)" 명시, https://versilian-studios.com/virtuosity-drums/) | 가능(고지·로열티 불필요) | 가능(고지·로열티 불필요) |
| lucide-react | ISC(확인됨, 2026-10-27, npm 레지스트리 `license` 필드, `npm info lucide-react license`) | 가능 | 가능 |
| Pretendard | SIL OFL ⚠확인 | 가능 | 가능 |
| pypdfium2 | Apache-2.0/BSD-3-Clause(확인됨, 2026-10-23) | 가능 | 가능 |
| ADTOF-pytorch(대안 채보 모델) | **없음**(LICENSE 파일·GitHub 라이선스 필드 모두 미표시, Q-15) | Phase 0 내부 테스트만 | 불가(해소 전) — Phase 3 채택 전 재확인 필요 |
| imageio-ffmpeg(파이썬 패키지, T3-16-feedback 음악 스템 MP3 압축용) | 패키지 자체 BSD-2-Clause(PyPI 확인, 2026-10-26). **단, 번들된 ffmpeg 실행파일은 별도** — 직접 실행해 빌드 설정 확인 결과 `--enable-gpl --enable-version3`(GPLv3) | 가능(배포 아님, 서버에서 돌리기만 함) | ⚠ GPLv3 — 바이너리를 포함해 배포 시 소스 공개 의무 등 재검토 필요(의뢰인 승인, 2026-10-26: 개인 사용 단계는 진행, 상업 배포 전 재확인) |
| @formkit/auto-animate(라이브러리 화면 카드 삭제/추가 슬라이드 transition, T3-36) | MIT(확인됨, 2026-10-27, `npm view` `license` 필드) | 가능 | 가능(고지) |
| 기타 | 추가 시 기록 | | |

## 5. 폴더 구조 (목표)
```
app/web/src/{features/{practice,library,editor,mixer,auth},audio,render,score,offline}
app/server/{api,worker,modules/{separator,transcriber,omr,importer},db,storage}
data/            (git 제외) 사용자 곡 데이터
```
