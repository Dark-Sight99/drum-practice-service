"""REQ-04(T6-11, Q-33) — 재생 배속(BPM)을 바꿔도 음정이 그대로 유지되도록,
서버가 ffmpeg `atempo` 필터로 스템을 사전 변환해 캐싱한다.

근거: work/T6-11/plan.md "백엔드 설계 요약"·"API 계약". 실시간 피치 보정
라이브러리(AudioWorklet 기반)는 전부 iOS 미해결 버그 위험이 있어 배제하고,
재생 "전에"(재생 중 배속 변경은 이미 UI에서 막혀 있음, 코드 확인됨) 서버가
한 번 변환해두는 방식을 택했다.
"""

import os
import subprocess
import tempfile
import threading
from pathlib import Path

import imageio_ffmpeg

from file_storage import SONGS_ROOT, song_storage_dir, write_song_file


class TempoStretchError(Exception):
    """ffmpeg atempo 변환(서브프로세스) 실패."""


# work/T6-11/plan.md "API 계약" — REQ-04의 배속 범위(원곡 대비 50~150%,
# permille 500~1500)에 부동소수점 반올림 여유(exactRate 계산 중 경계값이
# 499.9999...로 내려가는 경우 등)를 더한 값. ffmpeg atempo 필터 자체의 유효
# 입력 범위는 0.5~100(공식 문서)이라 이 범위 안에서는 체이닝 없이 단일 호출로
# 충분함(실측 확인, plan.md "백엔드 설계 요약").
PERMILLE_MIN = 490
PERMILLE_MAX = 1510

# work/T6-11/plan.md "동시성"(Codex 모드C 1차 C-006 반영) — 동기 `def` 라우트가
# 스레드풀에서 돌아 이벤트 루프는 안 막지만, 그게 "무제한 동시 변환"을 의미하진
# 않음 — 의뢰인 1인(+지인 소수) 사용 규모라 세마포어 2(드럼+음악 1곡 분량이
# 동시에 도는 정도)로 명시 제한. 그 이상은 세마포어 획득까지 대기(거부 응답
# 없음 — 큐잉으로 충분한 규모).
_CONCURRENCY_SEMAPHORE = threading.Semaphore(2)

# ffmpeg 서브프로세스 1회 호출의 최악 실측은 약 5.5초(두 스템 병렬 기준,
# plan.md) — 이 함수를 새로 만들며 처음 타임아웃을 추가한다(이 서버의 다른
# ffmpeg 서브프로세스 호출들 — demucs_separator.py의 encode_mp3()/apply_gain()
# 등 — 은 지금까지 타임아웃이 전혀 없었음을 직접 확인했음, "기존 패턴 재사용"이
# 아니라 이번에 처음 도입하는 안전장치).
SUBPROCESS_TIMEOUT_SECONDS = 120

# work/T6-11/plan.md "정리" — 전체(모든 곡 합산) 변환 캐시 용량 상한 제안치.
# 넘으면 오래 안 쓴(mtime 기준) 파일부터 지운다.
TOTAL_CACHE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024  # 2GiB

# 곡 하나당 "같은 (kind, permille) 변환을 동시에 두 번 돌리지 않기" 위한
# 키별 락(Codex 모드C 1차 C-006 "키별 락" 요구). 의뢰인 1인 사용 규모라 서버
# 수명 동안 쌓이는 키 개수가 실질적으로 작아 별도 정리 없이 둔다(과한 설계
# 방지 — CLAUDE.md §1-6).
_key_locks: dict[tuple[int, str, int], threading.Lock] = {}
_key_locks_guard = threading.Lock()


def _lock_for_key(song_id: int, kind: str, permille: int) -> threading.Lock:
    key = (song_id, kind, permille)
    with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


def time_stretch_mp3(input_path: Path, permille: int) -> bytes:
    """`input_path`(스템 WAV 또는 MP3)를 ffmpeg `atempo=permille/1000`으로
    변환해 MP3 바이트로 돌려준다.

    `permille`은 요청값 그대로 `atempo`에 전달한다 — ffmpeg 실제 출력 길이가
    아니라 **요청값 자체가 "적용 비율"의 정의**(Codex 모드C 1차 C-003,
    work/T6-11/plan.md "API 계약" — 프론트의 잔차 playbackRate 보정이 이 정의를
    전제로 계산되므로, 실측 길이로 바꿔치기하면 두 종류의 오차가 뒤섞인다).

    실측으로 발견된 주의점(plan.md): atempo 결과물은 배속별로 일정한(누적 안
    되는) 시작 오프셋이 있음(예: 0.5배속 약 −24ms) — 이 함수는 그 오프셋을
    보정하지 않는다(별도 이슈로 다룸, 지금은 체감 확인 전까지 보류).
    """
    if not PERMILLE_MIN <= permille <= PERMILLE_MAX:
        raise ValueError(f"permille 범위를 벗어남({PERMILLE_MIN}~{PERMILLE_MAX}): {permille}")

    rate = permille / 1000
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    fd, tmp_path_str = tempfile.mkstemp(suffix=".mp3")
    tmp_path = Path(tmp_path_str)
    try:
        # demucs_separator.py의 encode_mp3() 등과 같은 패턴 — close를 try
        # 안에 둬야 close 자체가 실패해도 finally의 unlink가 임시 파일을 치운다.
        os.close(fd)
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i",
            str(input_path),
            "-filter:a",
            f"atempo={rate}",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(tmp_path),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=SUBPROCESS_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise TempoStretchError(
                f"배속 변환 시간 초과({SUBPROCESS_TIMEOUT_SECONDS}초): {input_path.name}"
            ) from exc
        except OSError as exc:
            # demucs_separator.py의 _decode_to_wav_for_measurement()와 같은
            # 이유 — ffmpeg 실행 자체가 예외를 던지는 드문 경우(실행파일 손상·
            # 권한 문제 등)도 이 모듈의 다른 에러와 일관되게 변환.
            raise TempoStretchError(f"배속 변환 실행 실패: {exc}") from exc
        if proc.returncode != 0:
            raise TempoStretchError(
                f"배속 변환 실패(returncode={proc.returncode}): {proc.stderr[-2000:]}"
            )
        return tmp_path.read_bytes()
    finally:
        tmp_path.unlink(missing_ok=True)


def _evict_if_over_budget() -> None:
    """전역 변환 캐시 총 용량이 TOTAL_CACHE_BUDGET_BYTES를 넘으면 오래 안
    쓴(mtime 기준) 파일부터 지운다. 방금 캐싱에 성공한 뒤에 불리는 부가
    정리라, 여기서 실패해도(권한 등) 조용히 넘어간다 — 변환 자체는 이미 끝나
    사용자에게는 정상 응답이 나가야 한다."""
    try:
        cache_files = sorted(
            SONGS_ROOT.glob("*/tempo_*.mp3"), key=lambda p: p.stat().st_mtime
        )
    except OSError:
        return
    sized: list[tuple[Path, int]] = []
    total = 0
    for p in cache_files:
        try:
            size = p.stat().st_size
        except OSError:
            continue
        sized.append((p, size))
        total += size
    if total <= TOTAL_CACHE_BUDGET_BYTES:
        return
    for p, size in sized:  # mtime 오름차순 — 오래된 것부터
        if total <= TOTAL_CACHE_BUDGET_BYTES:
            break
        try:
            p.unlink(missing_ok=True)
            total -= size
        except OSError:
            continue


def get_or_create_tempo_mp3(song_id: int, kind: str, permille: int, source_path: Path) -> Path:
    """캐시(곡 폴더 안 평면 파일 `tempo_<kind>_<permille>.mp3` — 하위 디렉터리는
    기존 `delete_song_files()`가 못 지움, 실측 확인된 제약, plan.md "저장")가
    있으면 그 경로를, 없으면 `time_stretch_mp3()`로 변환해 캐싱하고 그 경로를
    반환한다. 키별 락으로 같은 (song_id, kind, permille) 변환이 동시에 중복
    실행되지 않게 하고, 전역 세마포어로 동시 ffmpeg 실행 수를 제한한다."""
    filename = f"tempo_{kind}_{permille}.mp3"
    cache_path = song_storage_dir(song_id) / filename
    lock = _lock_for_key(song_id, kind, permille)
    with lock:
        if cache_path.exists():
            # eviction의 "최근 사용" 판단 기준(mtime)을 갱신 — 캐시 적중도
            # "최근에 쓰인 파일"로 쳐야 다음 정리 때 먼저 안 지워진다.
            cache_path.touch()
            return cache_path
        with _CONCURRENCY_SEMAPHORE:
            audio_bytes = time_stretch_mp3(source_path, permille)
        write_song_file(song_id, filename, audio_bytes)
        _evict_if_over_budget()
        return cache_path
