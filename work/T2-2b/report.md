> 한 줄 요약: T2-2의 Tone.js 합성음을 실제 드럼 샘플(Virtuosity Drums, CC0)로 교체. drumVoices.ts를 WAV 버퍼 재생(Tone.Player, 트리거마다 새 인스턴스)으로 재작성, 실제 브라우저로 로드·재생·연타 확인.

# T2-2b 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/audio/drumVoices.ts` | Tone.js 신스 → 실제 WAV 샘플 버퍼 재생으로 전면 교체. `createDrumVoices()`가 비동기(`Promise<DrumVoiceMap>`)로 변경 | 의뢰인 피드백(T2-2 합성음이 실제 소리 같지 않음), `intent/07-open-questions.md` Q-19 |
| `app/web/public/audio/drums/*.wav` | 9종 분류별 실제 드럼 샘플(Virtuosity Drums, CC0에서 선정) | 같음 |
| `app/web/public/audio/drums/LICENSE.txt` | 출처·라이선스 고지 | CLAUDE.md §6(새 에셋 라이선스 기록) |
| `app/web/src/audio/drumVoices.test.ts` | `velocityToDb` 단위 테스트 4개 | `work/T2-2b/plan.md` 테스트계획 |
| `intent/03-architecture-stack.md` | 라이선스 표에 tone(MIT, T2-2에서 빠뜨렸던 것도 함께 기록)·Virtuosity Drums(CC0) 추가 | CLAUDE.md §6 |
| `intent/05-todo.md` | T2-2b 항목 추가·완료 표시 | — |

## 설계
- Tone.js 공식 문서(`Sampler.d.ts` 주석): 리피치가 필요 없는 샘플 재생엔 `Player`를 쓰라고 명시 — 우리는 각 피스를 항상 같은 음높이로만 재생하므로 `Sampler` 대신 `Player` 채택.
- `Tone.Player`는 `Source`를 상속해 **모노포닉**이다(실제 타입 정의로 확인) — 같은 피스가 빠르게 겹쳐 울리면 이전 소리를 끊고 재시작해버림. 트리거마다 **새 `Player` 인스턴스**를 만들고 끝나면(`onstop`) 스스로 `dispose()`하는 "발사 후 소멸" 패턴으로 구현(버퍼 자체는 피스당 1개만 미리 로드해 공유, 재생 노드만 매번 생성). 실제 브라우저에서 하이햇 6연타(0.15초 간격)로 끊김 없이 겹쳐 재생됨을 확인.
- `velocityToDb()`: 정규화 velocity(0~1)→dB 선형 매핑(1→0dB, 0→-24dB) — 각 피스가 벨로시티 레이어 1개뿐이라 정밀한 커브를 맞출 근거가 없어 단순하게 둠.

## 구현 근거 (실행 결과로 확인)
- Virtuosity Drums 공식 페이지에 "open source (Creative Commons 0)"로 명시된 것을 직접 확인(https://versilian-studios.com/virtuosity-drums/). 다운로드한 zip(1,227,151,376바이트)이 서버가 보낸 Content-Length와 정확히 일치함을 확인(온전한 다운로드).
- 원본 오디오는 **FLAC**(사전에 "WAV"로 추측했던 것과 다름 — 실제 압축 해제 후 확인) — 브라우저 호환성(특히 Safari/iOS, 이 프로젝트가 대상으로 하는 iPhone/iPad)을 고려해 Python `soundfile`로 WAV PCM_16으로 변환(피치·템포 가공 없음).
- 9종 각각 Virtuosity Drums의 실제 비가공 녹음에서 선정(파일별 상세는 `qa-evidence/T2-2b/result.md`). 톰이 팩에 2종(Low/High)뿐이라 우리 스키마의 3종과 안 맞는 문제는, 가공으로 억지 음높이를 만들지 않고 Low Tom의 서로 다른 실제 타법(center=mid, off-center=floor)으로 구분 — 둘 다 비가공 실제 녹음(CLAUDE.md 규칙1).
- 다운로드·압축해제에 쓴 임시 파일(1.2GB zip + 1.4GB 압축해제본)은 작업 완료 후 삭제, 최종 산출물(WAV 9개, 9.1MB)만 저장소에 남김.

## 실행한 검증
`qa-evidence/T2-2b/result.md`, `raw_log.txt` — tsc/oxlint/vitest(50/50) PASS. 실제 브라우저(Claude Browser pane)로 9종 샘플 로드·재생, 하이햇 연타 겹침 확인 — 전부 콘솔 에러 없음.

## 가정
- 벨로시티 레이어·마이크 포지션 각 1개만 사용(멀티샘플링은 범위 밖).
- `createDrumVoices()`의 동기→비동기 전환은 아직 소비 코드가 없어(T2-3 미착수) 하위 호환성 문제 없음.

## 질문
- 없음(의뢰인이 Virtuosity Drums 채택을 직접 지시함).

## 남은 문제
- T2-3(연습 화면)에서 `createDrumVoices()`가 비동기임을 고려해 로딩 상태 UI가 필요할 수 있음.
- 실제 음색이 의뢰인 기대에 맞는지는 다음 실사용 피드백으로 확인.
