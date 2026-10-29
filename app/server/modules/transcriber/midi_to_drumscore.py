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

**2026-10-27(Q-41 — 한 번 "뒤바뀜"으로 결론 냈다가, 하루 만에 되돌린
기록)**: 의뢰인이 사람이 만든 악보와 생성 노트를 비교하다 하이햇이 통째로
0개, 탐이 비정상적으로 많이(725개 중 280개) 잡히는 걸 발견. 그때는
"ADTOF-pytorch 벤더 패키지의 `LABELS_5` 채널 순서가 같은 패키지 예제
코드와 반대다"라는 가설을 세우고, GM42/47을 서로 바꿔서(T3-43) "고쳤다".
근거는 전체 315초 중 활성 프레임 비율(frac>threshold)뿐이었다 — "GM47
채널이 2.5% 활성, GM42 채널이 0% 활성"이라는 수치만 보고, GM47을
"거의 모든 마디에 나오는 하이햇"이라고 단정했다.

**바로 다음 날(의뢰인 재검증, "노트랑 하나도 안 맞아요") 그 가설이
틀렸음이 드러났다.** 재채보(song id=19)에서 같은 두 가지를 직접
재검증했다(`qa-evidence/T3-44/result.md`에 실행 결과 전부 기록):
1. **시간대별 분포**: GM47 채널(스왑 후 "hihat_closed")을 10초 단위로
   나눠 보면 10~30초·70~290초 구간에만 몰려 있고 그 사이(30~70초)엔
   완전히 비어 있다 — "거의 모든 마디에 꾸준히"가 아니라 곡 구간별로
   있다 없다 하는 패턴. frac>threshold 2.5%라는 숫자 하나만 보고
   "하이햇처럼 꾸준하다"고 판단한 게 성급했다.
2. **스펙트럼 분석(이번에 처음 함, 결정적 증거)**: 같은 채널의 온셋
   시각마다 오디오를 80ms씩 잘라 FFT를 떠 보면, 스펙트럼 중심
   주파수가 평균 1094Hz(미디언 1019Hz)고 300Hz 이하 저주파 에너지
   비율이 62%다 — 킥(중심 566Hz, 저주파 83%)과 스네어(중심 1597Hz,
   저주파 50%) 사이, **킥 쪽에 훨씬 가까운** 값이다. 실제 닫힌
   하이햇은 보통 중심 주파수가 수 kHz 이상이고 저주파 에너지가
   거의 없어야 하는데, 이 채널은 그 반대로 "낮고 공명하는" 소리 —
   하이햇이 아니라 **탐의 스펙트럼 특징**과 일치한다.

결론: GM47 채널은 원래(T3-43 이전) 매핑대로 **탐이 맞았다** — T3-43의
스왑은 틀린 가설을 근거로 한 회귀(regression)였다. GM42 채널이 315초
내내 한 번도 안 울리는 것은 여전히 사실이지만, 그건 "라벨이 뒤바뀌어서"가
아니라 **ADTOF-pytorch 모델이 이 곡에서 하이햇을 거의 못 잡아낸다는,
모델 자체의 한계**로 다시 분류한다(별도 과제로 Q-41에 기록, 성급히 다시
"바꾸기"로 고치지 않음 — 벤더 모델의 인식 실패는 우리 매핑을 바꿔서
해결할 문제가 아니다).

PITCH_TO_PIECE는 GM 표준 관례대로 되돌린다(42→hihat_closed,
47→tom_mid) — T3-43 이전 상태와 동일.
"""

import pretty_midi

# GM 퍼커션 피치 -> 우리 DrumPiece(app/web/src/score/types.ts의 9종과 동일,
# api/schemas.py의 DrumPiece Literal과 수동 동기화). GM 표준 관례를 그대로
# 따른다 — T3-43에서 한 번 "뒤바뀜" 가설로 42/47을 스왑했다가, T3-44에서
# 스펙트럼 분석(위 모듈 docstring 참고)으로 그 가설이 틀렸음을 확인하고
# 되돌렸다. 49(심벌 합산) -> crash: REQ-02 명세가 크래시를 라이드보다
# 먼저 언급.
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


def midi_to_drumscore(
    midi: pretty_midi.PrettyMIDI,
    title: str,
    bpm: float,
    downbeat_offset_seconds: float = 0.0,
) -> tuple[dict, int]:
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

    `downbeat_offset_seconds`(2026-10-27, T3-72, intent/07-open-questions.md
    Q-43)도 호출자가 넘긴다 — `tempo.py`의 `estimate_downbeat_offset_seconds()`
    로 추정한, "진짜 다운비트(1박)가 오디오 파일 시작으로부터 몇 초 뒤인지"
    값. 예전엔 "오디오 파일 시작 = 틱 0"으로만 가정해(이 값이 항상 0),
    실측 결과 전체 곡이 일정하게(0.2~0.3초대) 밀려 보이는 원인이었다 —
    이제 이 값만큼 뺀 뒤 틱을 계산해 **틱 0이 실제 다운비트를 가리키도록
    재앵커**한다(work/T3-72/plan.md §1). 메트로놈·편집기 격자선은 순수
    틱 계산이라 이 재앵커만으로 추가 코드 변경 없이 저절로 맞아떨어진다.
    `audioOffsetMs`는 더 이상 "0 고정"이 아니라 이 값(ms 단위)을 그대로
    저장 — 음원 트랙(분리된 스템) 재생 위치 계산에만 쓰인다(노트 틱
    자체는 이미 보정됐으므로 다시 안 씀).
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
                    #
                    # 2026-10-27(T3-72, Q-43) — `downbeat_offset_seconds`(위
                    # 함수 docstring 참고)만큼 먼저 뺀 뒤 환산해 틱 0이 실제
                    # 다운비트를 가리키도록 재앵커한다. 다운비트보다 이른
                    # 노트(카운트인성 타격 등, `downbeat_offset_seconds=0`
                    # 이면 애초에 생기지 않음)는 틱 0으로 클램프 — 음수 틱은
                    # `DrumScoreIn`이 어차피 거부한다(`api/schemas.py`).
                    "tick": max(
                        0, round((note.start - downbeat_offset_seconds) * bpm / 60 * ppq)
                    ),
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
        # 2026-10-27(T3-72, Q-43) — 더 이상 0 고정이 아니라 "틱 0(다운비트)이
        # 원곡 파일에서 몇 ms 지점인지"(위 함수 docstring 참고). 노트 틱
        # 자체는 이미 이 값만큼 보정됐으므로(위), 여기선 음원 트랙 재생
        # 위치 계산에만 쓰라고 그대로 저장만 한다.
        "audioOffsetMs": round(downbeat_offset_seconds * 1000),
        "notes": notes,
    }
    return drumscore, unmapped_count
