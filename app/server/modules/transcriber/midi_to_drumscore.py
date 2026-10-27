"""ADTOF(5-class) MIDI를 우리 DrumScore(9-class) 구조로 변환. 근거: REQ-02,
work/T3-2/plan.md §2.

**이 모듈의 가장 중요한 설계 결정**: ADTOF는 하이햇(열림/닫힘)·탐(하이/미드/
플로어)·심벌(크래시/라이드)을 각각 하나로 합쳐 출력한다(`adtof_pytorch/
post_processing.py`의 `LABELS_5 = [35, 38, 47, 42, 49]`, 실측 확인).
`intent/02-requirements.md`의 "모델이 구분 못 하는 분류는 상위 분류로
합친다"는 이미 승인된 원칙이지만, 합친 뒤 **어느 구체적 피스 이름으로
보여줄지**는 이번에 내리는 명시적 기본값 선택이다 — 추측을 감추지 않고
`intent/07-open-questions.md` Q-26에 그대로 기록했다. 더 나은 해법(음량
휴리스틱, 하이브리드 악보 입력)은 Q-26에 "향후 검토"로 남아 있고, 지금은
REQ-03 편집기로 사용자가 직접 고치는 게 유일한 보정 수단이다.
"""

import pretty_midi

# GM 퍼커션 피치 -> 우리 DrumPiece(app/web/src/score/types.ts의 9종과 동일,
# api/schemas.py의 DrumPiece Literal과 수동 동기화).
# 42(하이햇 합산) -> hihat_closed: 더 흔히 쓰이는 쪽을 기본값으로.
# 47(탐 합산) -> tom_mid: 하이/플로어 양 극단이 아닌 중간값을 기본값으로.
# 49(심벌 합산) -> crash: REQ-02 명세가 크래시를 라이드보다 먼저 언급.
PITCH_TO_PIECE: dict[int, str] = {
    35: "kick",
    38: "snare",
    42: "hihat_closed",
    47: "tom_mid",
    49: "crash",
}

DEFAULT_VELOCITY_NOTE = (
    "ADTOF-pytorch CLI는 velocity=100을 하드코딩한다(모델 예측이 아님, "
    "adtof_pytorch/cli.py 소스 확인, intent/07-open-questions.md Q-10)."
)


def midi_to_drumscore(midi: pretty_midi.PrettyMIDI, title: str, bpm: float) -> tuple[dict, int]:
    """ADTOF가 만든 `PrettyMIDI` 객체를 `DrumScoreIn`(api/schemas.py) 호환
    dict로 변환한다. `(drumscore_dict, unmapped_pitch_count)`를 반환 —
    `PITCH_TO_PIECE`에 없는 피치(ADTOF 5-class 출력엔 원래 없어야 하지만,
    모델이 바뀌는 등으로 생기면)는 조용히 버리지 않고 건너뛰되 개수를 따로
    세어 반환한다(T2-1 `midiToDrumScore`의 `unmappedNoteCount` 집계 관례와
    통일 — `DrumScoreIn`엔 없는 필드라 저장할 dict에는 안 섞고 호출자가
    로그로만 남기도록 분리).

    `bpm`은 호출자가 넘긴다(2026-10-27, intent/07-open-questions.md Q-40) —
    예전엔 `midi.get_tempo_changes()`로 MIDI 자체의 템포를 읽었는데, ADTOF가
    템포를 전혀 추정하지 않아(온셋 분류 모델일 뿐) `pretty_midi.PrettyMIDI()`가
    항상 라이브러리 기본값(120)만 돌려주고 있었다 — 실제 곡 템포와 무관한
    값이 계속 저장돼온 버그였음. 이제 호출자(`handler.py`)가
    `modules/transcriber/tempo.py`의 `estimate_tempo()`로 드럼 스템에서 직접
    추정한 값을 넘긴다.
    """
    ppq = midi.resolution
    notes: list[dict] = []
    unmapped_count = 0
    for instrument in midi.instruments:
        for note in instrument.notes:
            piece = PITCH_TO_PIECE.get(note.pitch)
            if piece is None:
                unmapped_count += 1
                continue
            notes.append(
                {
                    # 2026-10-27(Q-40) — `midi.time_to_tick()`은 MIDI 내부
                    # 템포 맵(ADTOF가 템포를 전혀 추정하지 않아 pretty_midi
                    # 기본값 120에 고정돼 있음, Q-40)을 기준으로 환산하는데,
                    # 여기 `bpm`은 그 기본값이 아니라 새로 추정한 실제 템포다
                    # — 둘이 다른 상태에서 `time_to_tick()`을 그대로 쓰면
                    # 저장되는 틱 자체가 어긋나 소리 타이밍이 밀린다. 반면
                    # `note.start`(초)는 템포 맵과 무관하게 항상 실제 온셋
                    # 시각 그대로다(pretty_midi 공식 동작, 직접 실행해 확인)
                    # — 그래서 `time_to_tick()`을 쓰지 않고 `note.start`를
                    # 이 함수가 받은 실제 `bpm` 기준으로 직접 틱으로 환산한다.
                    "tick": round(note.start * bpm / 60 * ppq),
                    "piece": piece,
                    "velocity": note.velocity,
                    "hand": None,
                }
            )
    notes.sort(key=lambda n: n["tick"])

    drumscore = {
        "version": 1,
        "meta": {
            "title": title,
            "bpm": bpm,
            # ADTOF는 박자표를 전혀 추정하지 않음(온셋 분류 모델이라 마디 개념이
            # 없음, 실측 확인) — REQ-02에 다른 기준이 없어 가장 흔한 4/4로 고정.
            "timeSignature": [4, 4],
            "source": "audio",
        },
        "ppq": ppq,
        "audioOffsetMs": 0,
        "notes": notes,
    }
    return drumscore, unmapped_count
