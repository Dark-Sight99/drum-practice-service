> 한 줄 요약: T6-3 설계안 — bass/vocals/other 3스템을 서버에서 1개 파일로 사전 믹스해 동시 오디오 디코딩 스트림을 4개→2개로 줄인다(모바일 fps 원인 해결, T6-2 실측 확정). Codex 모드C 1차 "수정 후 진행" 반영 완료(amix 정규화 off 명시, 프런트 필터링으로 변경해 파괴적 삭제 제거).

# T6-3 설계안 — 오디오 스템 사전 믹스

근거: `intent/05-todo.md` Phase 6 T6-3, `intent/07-open-questions.md` Q-33(2차 결과·원인 확정 섹션). REQ-04/05 핵심 오디오 재생 구조 변경이라 구현 전 설계 검수.

## 문제

T6-2 실측으로 확정: 믹서에서 음소거해도 `setChannelGain()`은 `gain`만 0으로 할 뿐 `<audio>` 엘리먼트는 계속 디코딩·재생됨(`trackPlayer.ts`) — 4개 실제 오디오 스템(`stem_drums/bass/vocals/other`)이 항상 동시에 디코딩돼 모바일 CPU를 다 씀. 실기기에서 4개 중 3개(bass/vocals/other)를 직접 `pause()`하자 즉시 60fps 안정 확인.

## 왜 bass/vocals/other만 합치나

- `app/web/src/audio/mixer.ts`의 `MUSIC_STEM_KEYS = ['stem_bass', 'stem_vocals', 'stem_other']` — T3-8(의뢰인 요청)에서 이미 UI 슬라이더 하나·음소거 버튼 하나로 묶여 있음(개별 조작 기능 자체가 없음). 합쳐도 **현재 노출된 기능 손실 없음**(의뢰인 확인 완료, 이 대화에서).
- `stem_drums`는 "원곡 드럼 켜기"로 **개별 토글되는 실제 기능**이라 그대로 유지 — 합치면 그 기능이 사라짐.
- 결과: 동시 스트림 4개 → 2개(드럼 + 음악).

## 범위

### 백엔드

1. **`db/models.py`**: `AssetKind`에 `STEM_MUSIC = "stem_music"` 추가, `AUDIO_ASSET_KINDS` 튜플에 포함. (Codex C-003 — "컬럼 정의·제약을 직접 확인하라") `Asset.kind` 컬럼을 직접 읽어 재확인: `mapped_column(str_enum_column(AssetKind), ...)` → `str_enum_column()` = `Enum(enum_cls, native_enum=False, values_callable=...)`(models.py:35). SQLAlchemy의 `Enum(..., native_enum=False)`는 `create_constraint`를 별도로 `True`로 안 넘기면(이 코드는 안 넘김) DB에 CHECK 제약을 만들지 않고 평범한 VARCHAR로 렌더링 — 즉 새 Python enum 멤버 추가는 DB 스키마와 무관, **Alembic 마이그레이션 불필요** 재확인됨. `Asset` 테이블의 `__table_args__`(models.py:174-185)에 있는 CHECK 제약은 `file_path` 트래버설 방지용이라 `kind` 값과 무관 — 영향 없음.
2. **`modules/separator/demucs_separator.py`**: 새 함수 `mix_stems(wav_paths: list[Path], gain_linear: float, bitrate_kbps: int = 192) -> bytes` — ffmpeg `amix` 필터로 여러 WAV를 하나로 합치면서 동시에 `encode_mp3()`와 같은 방식으로 MP3 인코딩까지 한 번에(재인코딩 2번 안 거침). `encode_mp3()`/`apply_gain()`과 같은 `imageio_ffmpeg` 패턴 재사용.
   - **(Codex C-002 반영)** ffmpeg 공식 문서(ffmpeg.org/ffmpeg-filters.html#amix) 확인 결과 `amix`는 기본적으로 `normalize=1`(활성화)이라 입력을 자동으로 정규화해버려 "3개를 그냥 더한 것"과 다른 결과가 나옴 — 지금 체감 음량은 "3개의 실제 `<audio>` 엘리먼트가 동시에 재생되며 물리적으로 그냥 더해지는" 것(스피커/오디오 출력 단계의 자연스러운 합산, 정규화 없음)이므로, 이를 그대로 재현하려면 **`amix=inputs=3:duration=longest:normalize=0`로 정규화를 명시적으로 꺼서 순수 합산**이 되게 한다. 명령 형태: `-i bass.wav -i other.wav -i vocals.wav -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest:normalize=0,volume={gain}" -codec:a libmp3lame -b:a 192k out.mp3`. **그래도 클리핑(0dBFS 초과) 가능성은 남음** — 3개 신호를 그�음 더하면 피크가 개별 신호보다 높아질 수 있어, 구현 시 실제 믹스 결과의 피크를 측정해 클리핑 여부 확인 필요(테스트 계획 참고).
3. **`modules/separator/handler.py`**: `written` 루프에서 `bass`/`other`/`vocals` 개별 `write_song_file()`+`Asset` 생성을 제거하고, 대신 그 3개 임시 WAV 경로를 `mix_stems()`에 넘겨 `stem_music.mp3` 하나로 저장 + `Asset(kind=STEM_MUSIC)` 하나 생성. `drums`는 기존 그대로(WAV+사이드카 MP3, 채보 파이프라인이 읽으므로 무수정).
4. **실패 처리 (Codex C-005 반영)**: `mix_stems()`가 예외를 던지면(입력 WAV 누락, ffmpeg 실패 등) 이미 `handler.py`의 바깥 `try` 블록 안에서 호출되므로 기존 `except Exception` 롤백 경로(Song.FAILED, `written`에 쓰인 파일만 정리)가 그대로 적용됨 — `mix_stems()` 호출을 다른 stem 쓰기와 **같은 try 범위 안에, `written.append()`보다 먼저** 두어 "부분 기록" 상태가 생기지 않게 한다(이 곡은 "전부 성공 아니면 FAILED" 원칙 유지, 일부 스템만 제공하는 부분 성공 상태는 만들지 않음 — 기존 핸들러의 원칙과 동일).
5. **배포 중 진행 작업(Codex C-004)**: 이 프로젝트는 1인 사용자가 수동으로 서버를 재시작하며 배포하는 구조(워커도 같은 프로세스 묶음, `scripts/start.py`)라, 배포 "도중" 정확히 작업이 걸쳐있는 경우는 사실상 없음(재시작하면 워커도 같이 꺼졌다 켜짐, 진행 중이던 작업은 재시작 후 다시 시도되거나 실패로 남음 — 기존에도 이미 그런 구조). 별도 처리 불필요로 판단, 범위 밖(CLAUDE.md §6).

### 프런트엔드 (최소 변경 — 믹서 저장 스키마·`MixerState`·`ChannelKey`는 전혀 안 건드림)

5. **`PracticeCanvas.tsx`의 `stemKinds` 계산**(line ~560, ~1352) — **(Codex C-001/C-008 반영, 설계 변경)** 처음엔 "변경 불필요"로 뒀으나, 그러면 기존 곡(Pretender)처럼 구 개별 스템(`stem_bass/vocals/other`) Asset이 남아있는 채로 `stem_music`을 추가하면 `available_audio_kinds`에 신·구가 전부 섞여 5트랙이 만들어지는 함정이 있음(Codex가 지적한 핵심 위험, 이미 계획에서도 인지했던 부분). **파일 삭제 대신 프런트에서 필터링**하기로 변경 — 되돌릴 수 없는 삭제를 피하는 쪽이 더 안전하다는 Codex 의견 채택:
   ```ts
   const rawKinds = availableAudioKinds.filter((kind) => kind !== 'original')
   const stemKinds = rawKinds.includes('stem_music')
     ? rawKinds.filter((kind) => kind !== 'stem_bass' && kind !== 'stem_vocals' && kind !== 'stem_other')
     : rawKinds
   ```
   `stem_music`이 있으면 구 3종을 제외(있어도 무시), 없으면(아직 백필 전·오래된 곡) 기존처럼 3개를 그대로 씀 — **하위 호환**. 이 필터는 영구 로직으로 남지만(Codex도 "영구 규칙이 되는 비용"을 언급) 삭제보다 안전함을 우선.
6. **믹서 게인 적용 루프 2곳**(line ~910-923 재생 중 반영, ~1520-1532 `handlePlay()` 초기 설정): 기존 `for (const key of CHANNEL_KEYS)` 루프는 그대로 두되(`stem_bass`/`stem_vocals`/`stem_other`에 대한 `setChannelGain()` 호출은 풀에 해당 트랙이 없으면 조용히 no-op — `trackPlayer.ts:413-414` `if (!track) return` 확인됨, 안전), 루프 밖에 한 줄 추가:
   ```ts
   session.tracks?.setChannelGain('stem_music', effectiveGain(mixerState.stem_bass))
   ```
   `stem_bass`/`vocals`/`other`는 `setMusicVolume()`/`setMusicMuted()`가 항상 셋을 동일하게 맞추므로(기존 불변식, `mixer.ts` 확인됨) 셋 중 아무 값이나 대표로 써도 무방 — `musicVolume()`(평균, UI 표시용)이 아니라 `effectiveGain()`(음소거 반영)을 직접 써야 함.
7. **MIDI 전용 곡**(스템 자체가 없는 곡): `stemKinds.length === 0` 조기 반환 경로 무수정 — 영향 없음.

### 기존 곡(Pretender) 백필 — 비파괴적으로 변경(Codex C-001 반영)

8. 서버에 이미 있는 `stem_bass.mp3`/`stem_vocals.mp3`/`stem_other.mp3`(디스크에 이미 존재, 재분리 불필요)를 `mix_stems()`로 합쳐 `stem_music.mp3` 생성 + `Asset(kind=STEM_MUSIC)` 추가 — **이것만 함, 추가(add)뿐**.
9. 구 개별 Asset 3개(STEM_BASS/VOCALS/OTHER)·파일은 **삭제하지 않고 그대로 둠** — 위 §5의 프런트 필터링이 `stem_music` 존재 시 자동으로 무시하므로 더 이상 불필요한 삭제 작업 자체가 필요 없음. 되돌릴 수 없는 작업이 설계에서 사라짐 — 백필은 몇 번을 재실행해도 안전(이미 `stem_music`이 있으면 건너뛰게만 하면 됨, 멱등).
10. 신규 업로드 곡은 핸들러 변경만으로 자동으로 `stem_drums`+`stem_music` 2-Asset 구조가 됨 — 처음부터 구 3종 자체가 안 생기므로 백필 대상이 아님. 백필은 이미 있는 1곡(Pretender)에만, 1회, 안전하게 실행.

## 테스트 계획

- `demucs_separator.py`의 `mix_stems()` 단위 테스트: 길이가 다른 입력(예: 무음 패딩 여부), 결과 파일이 유효한 MP3인지(디코드 가능한지), 피크/RMS가 원곡과 합리적 범위인지, **클리핑(피크>0.99) 여부**(C-002 — normalize=0이라 순수 합산, 클리핑 가능성 실측 필요).
- `handler.py` 통합 테스트: `written` 목록에 `stem_music`만 있고 `stem_bass/vocals/other`는 없는지, Asset row가 정확히 생성되는지, 실패 시 롤백이 `stem_music.mp3` 하나만 정리하는지(C-005).
- 프런트: 믹서 게인 적용 useEffect/handlePlay()에 대한 기존 테스트가 있다면 `setChannelGain('stem_music', ...)` 호출이 추가됐는지 회귀 테스트. **(Codex C-006)** 다음 케이스 전부 확인: 초기 로드 시 저장된 믹서 값 복원, 재생 중 "음악" 슬라이더 조절, 음소거 토글, "원곡 드럼 켜기" 프리셋(stem_drums만 건드려야 함 — stem_music에 영향 없는지). **(Codex C-007)** `stem_music` 없이 구 3종만 있는 곡(백필 전), MIDI 전용 곡(스템 자체 없음) 둘 다 기존처럼 동작하는지.
- **실제 청취 비교**(기계적 테스트로 못 잡는 부분): 합친 음원이 기존 3트랙 동시재생과 **음량·밸런스가 같게 들리는지** 실제로 들어서 확인(브라우저 녹음 또는 직접 청취) — `amix` 정규화 문제 때문에 특히 중요.
- 최종: 실기기 재측정(T6-4) — fps가 실제로 올라가는지.

## 리스크·미확정 사항 (추측 아님, 명시)

- `normalize=0`으로 순수 합산하면 클리핑 가능성이 생김 — 구현 시 이 PC에 번들된 `imageio_ffmpeg` 버전으로 실제 실행해 피크 확인 필요(단위 테스트 포함).
- 4→2로 줄이면 "확실히 개선"되지만 **60fps에 완전히 도달하는지는 불확실**(T6-2에서 이미 의뢰인께 명시) — T6-4 실측 후 추가 작업(T6-5+) 필요할 수 있음.
- 백필을 비파괴적으로 바꿔 되돌릴 수 없는 삭제는 설계에서 제거됨 — 별도 승인 불필요.

## Codex 모드C 검수 이력

- **1차**: "수정 후 진행" — C-001(백필 삭제 위험, 프런트 필터링으로 전환해 해결) · C-002(amix 정규화, 공식 문서로 확인해 `normalize=0` 명시로 해결) · C-003(DB 제약, 직접 재확인) · C-004(배포 중 작업, 범위 밖으로 명시) · C-005(실패 롤백, 기존 구조로 커버됨을 명시) 전부 본 문서에 반영 완료. C-006/C-007은 테스트 계획에 반영. Codex 자신의 샌드박스에서 한글 파일을 읽지 못해(PowerShell 인코딩·rg 미설치) 일부 항목은 "확인 필요"로 남겼는데, 그중 DB 제약(C-003)은 마스터가 직접 재확인함.
