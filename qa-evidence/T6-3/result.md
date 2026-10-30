> 한 줄 요약: T6-3(Phase 6, 모바일 성능 개선 v1.2) — bass/vocals/other 3스템을 서버에서 1개(stem_music)로 사전 믹스해 동시 오디오 디코딩 스트림을 4개→2개로 줄임. Codex 모드C 설계 검수(1차 수정 후 진행) + 모드A 1차(REQUEST_CHANGES, 반영) 전부 완료, 백엔드·프런트 전부 테스트 통과, 실기기 재생·fps 확인은 T6-4.

# T6-3 결과

근거: `work/T6-3/plan.md`, `intent/05-todo.md` Phase 6 T6-3, `intent/07-open-questions.md` Q-33(원인 확정 섹션).

## 구현 내용

### 백엔드
1. **`db/models.py`**: `AssetKind.STEM_MUSIC` 추가, `AUDIO_ASSET_KINDS`에 포함. 컬럼이 `native_enum=False`(VARCHAR, 앱 레벨 검증)임을 재확인 — 마이그레이션 불필요.
2. **`modules/separator/demucs_separator.py`**: `mix_stems()` 신설 — ffmpeg `amix` 필터(`normalize=0`로 순수 합산, Codex C-002 반영)로 WAV 여러 개를 합친 뒤, 합산 결과의 실제 피크를 `librosa`로 재측정해 0.99를 넘으면 게인을 추가로 낮춰 클리핑을 막는다(개별 스템은 안전해도 합치면 넘을 수 있다는 실제 위험을 자체 안전장치로 처리).
3. **`modules/separator/handler.py`**: `bass`/`vocals`/`other`를 더 이상 개별 Asset으로 안 만들고 `mix_stems()`로 합쳐 `stem_music.mp3` Asset 하나로 저장. `drums`는 무수정.
4. **`scripts/_backfill_stem_music.py`**(일시적, 실행 후 삭제 예정): 기존 곡의 이미 분리된 개별 스템 mp3를 다시 분리하지 않고 그대로 합쳐 `stem_music` Asset을 "추가"만 함(삭제 없음, Codex C-001 반영 — 비파괴적 설계).

### 프런트엔드 (믹서 저장 스키마는 전혀 안 건드림)
5. **`app/web/src/audio/trackPlayer.ts`**: `selectStemKinds()` 신설 — `available_audio_kinds`에서 `stem_music`이 있으면 구 개별 스템(`stem_bass/vocals/other`)을 걸러내고, 없으면(백필 전 곡) 기존처럼 그대로 씀. `PracticeCanvas.tsx`의 리렌더-전용 컴포넌트 파일에서 React Fast Refresh 경고가 나길래(oxlint `only-export-components`) `trackPlayer.ts`로 옮겨 해결.
6. **`PracticeCanvas.tsx`**: `stemKinds` 계산 두 곳이 `selectStemKinds()`를 쓰도록 변경. 믹서 게인 적용 루프(재생 중 반영 1곳 + `handlePlay()` 초기화 1곳) 끝에 `setChannelGain('stem_music', effectiveGain(mixerState.stem_bass))` 한 줄씩 추가 — `stem_bass/vocals/other`는 항상 같은 값으로 묶여 있다는 기존 불변식을 그대로 활용, 풀에 `stem_music`이 없는 곡(백필 전)에선 조용히 no-op(안전 확인됨).

## 테스트

- **백엔드**: `pytest` 243개 전부 통과(신규 `mix_stems()` 단위 테스트 5개 — **실제 ffmpeg로** 순수 합산 확인(정규화 안 됨, 2배 진폭 실측), 클리핑 방지 확인(개별 0.6 피크 2개 합쳐도 결과 피크 ≤1.01), 게인 적용, 빈 입력 예외, 단일 입력 통과. `test_separate_handler.py` 5개 테스트를 새 2-Asset 구조에 맞게 갱신). `ruff check` 0건.
- **프런트**: `vitest` 341개 전부 통과(신규 `selectStemKinds()` 테스트 4개 — 하위 호환, 우선순위 필터링, MIDI 전용 곡. 신규 `normalizeMusicChannels()` 테스트 4개 — Codex 모드A C-001 반영분). `tsc --noEmit` 0건. `oxlint` 경고 4건 — 전부 이번 변경과 무관한 기존 경고(baseline과 동일 내용·줄 번호만 이동, `git stash` 대조로 전례 확인된 패턴 재사용).
- **실제 DB 백필**: 운영 DB에 실행 — song 5~11 전부(7곡) `stem_music.mp3` 생성 성공, 재실행 시 "백필 대상 없음"으로 멱등성 확인.
- **브라우저 실측**(Vite 개발 서버, 로그인 계정): 서버 재시작 후 `GET /songs`가 `available_audio_kinds`에 `stem_bass/vocals/other`(구)와 `stem_music`(신) 둘 다 포함해 돌려주는 것 확인 → 연습 화면 재생 시 네트워크 탭에서 **정확히 2개 오디오 요청(`stem_drums`, `stem_music`)만** 발생함을 직접 확인(구 3종 요청 없음 — selectStemKinds 필터링 동작 확인). 믹서 "음악" 슬라이더·음소거·"원곡 드럼 켜기" 프리셋 조작 전부 콘솔 에러 없이 정상 동작. 노트 렌더링·색상·FPS(60) 전부 변경 전과 동일.

## Codex 검수

- **모드C(설계) 1차**: "수정 후 진행" — C-001(백필 삭제 위험) → 프런트 필터링으로 전환해 되돌릴 수 없는 삭제 자체를 설계에서 제거. C-002(amix 정규화, ffmpeg 공식 문서로 확인) → `normalize=0` 명시 + 자체 클리핑 재측정 안전장치 추가. C-003(DB 제약) → 직접 재확인. C-004(배포 중 작업) → 1인 수동 배포 구조라 범위 밖으로 명시. C-005(실패 롤백) → 기존 `written` 리스트 기반 정리 구조가 그대로 커버됨을 확인. C-006/C-007 → 테스트 계획에 반영(브라우저 실측으로 음소거·프리셋 토글 확인). 전부 `work/T6-3/plan.md`에 반영 완료 후 구현.
- **모드A(구현) 1차**: REQUEST_CHANGES — **C-001(중간, 실제 버그로 확인·반영)**: `stem_music`에 대표 게인으로 `stem_bass` 값 하나만 읽는데, 서버에 저장된 믹서 설정이 이 기능 이전(T3-8 이전 솔로 기능 시절 등)의 레거시 데이터라 bass/vocals/other가 서로 다를 수 있음 — 그러면 합쳐진 트랙의 첫 재생 음량이 예전 3트랙 합과 달라질 수 있었음. **수정**: `mixer.ts`에 `normalizeMusicChannels()` 신설(기존 `musicVolume()`/`isMusicMuted()`의 "대표값" 규칙을 그대로 재사용 — 새 규칙 안 만듦) — 서버에서 믹서 설정을 불러온 직후(`PracticeCanvas.tsx`의 `settleInitialLoad`) 한 번 정규화해, 그 뒤로는 불변식이 항상 성립하게 함. 단위 테스트 4개 추가(일관 상태 무변화, 다른 값 평균화, 부분/전체 음소거 구분, 다른 채널 무영향).
- **모드A(구현) 2차**: **APPROVE**, 지적사항 없음 — 정규화 호출 순서(로드 병합 직후, 사용자 편집 보존 루프 이전)·저장 로직과의 상호작용·단위 테스트 4개 전부 재확인 완료.

## 한계

- 실제 소리가 "지금과 똑같이 들리는지"는 브라우저에서 재생 버튼으로 직접 들어본 것 외에 파형 비교 등 정밀 검증은 안 함 — `mix_stems()` 단위 테스트가 실제 ffmpeg로 진폭·클리핑을 수치로 확인했지만, MP3 손실 압축 특유의 음질 차이까지는 검증 범위 밖.
- 모바일 fps가 실제로 올라가는지는 이 문서의 범위가 아님 — **T6-4(실기기 재측정)**에서 확인 예정.
- 백필 스크립트(`scripts/_backfill_stem_music.py`)는 일회성이라 실행 확인 후 삭제 예정(`work/T6-3/plan.md` §9).
