> 한 줄 요약: Demucs 분리 모듈(Separator) 구현 + 작업 큐 연결 — 음원 업로드 API 신설(`POST /songs/audio`), `JobType.SEPARATE` 핸들러로 Demucs를 백그라운드에서 돌려 drums/bass/vocals/other 4트랙을 Asset으로 저장. "공개 API 변경 + 외부 모델 연동"(위험 작업)이라 구현 전 Codex 모드C 설계 검수 필요.

# T3-1 plan — Separator 모듈(Demucs) + 작업 연결

## 근거 REQ
REQ-01 오디오 분리 — 입력(mp3/wav/m4a/flac), Demucs로 drums/bass/vocals/other 분리, 수용 기준(3~5분 곡 업로드 → 분리 완료 후 각 트랙 개별 재생 가능, 진행률/상태 표시, 처리 시간 로그 기록).

## 이미 있는 것(재사용, 새로 안 만듦)
- DB 스키마: `AssetKind.STEM_DRUMS/STEM_BASS/STEM_VOCALS/STEM_OTHER`, `JobType.SEPARATE`, `SongSourceType.AUDIO`, `SongStatus.PENDING/PROCESSING/COMPLETED/FAILED` — T1-2에서 이미 Phase 3를 내다보고 정의됨. **DB 마이그레이션 불필요.**
- 작업 큐: `worker/runner.py`(FIFO 선점·재시작 복구), `worker/handlers.py`(`register_handler(JobType, handler)` 레지스트리, 지금 비어있음) — T1-4에서 이미 구현.
- 상태 조회 API: `GET /songs/{id}`(status 필드), `GET /jobs`·`/jobs/{id}` — T1-4/T2-5에서 이미 구현, REQ-01 "진행률/상태 표시" 수용 기준을 이걸로 충족(새 폴링 API 불필요).
- 파일 저장: `file_storage.py`의 `write_song_file()`(원자적 교체, 경로 검증) — 그대로 재사용.
- 모델 선택: `modules/separator/` 빈 디렉터리(T1-1 스캐폴딩) — 여기에 구현.

## 범위
**백엔드만.** 프런트엔드 음원 업로드 화면은 범위 밖(todo.md의 T3-1 항목 자체가 "Separator 모듈 + 작업 연결"로 모듈·API·큐 연결만 명시 — UI는 이후 작업에서 다룸, 지금 추가하면 범위 밖 작업 금지 위반). 검증은 pytest(TestClient + `worker.run_once()` 직접 호출)로 end-to-end 확인.

## 설계

### 1. `app/server/modules/separator/demucs_separator.py`
- `separate(input_path: Path, output_dir: Path, device: str = "auto") -> dict[str, Path]` — `python -m demucs -n htdemucs -d <device> -o <output_dir> <input_path>`를 서브프로세스로 실행(T0-1 `bench_demucs.py`와 동일 커맨드 패턴, 이미 윈도우 RTX 5060에서 검증된 방식). 반환: `{"drums": Path, "bass": Path, "vocals": Path, "other": Path}`.
- `device="auto"`일 때 `torch.cuda.is_available()` → cuda, 아니면 `torch.backends.mps.is_available()` → mps, 아니면 cpu(`intent/03-architecture-stack.md` §2 "device 자동 선택 cuda→mps→cpu" 그대로).
- 실패(returncode != 0)면 stderr 마지막 2000자를 포함한 예외를 던짐(T2-5 업로드 에러 패턴과 통일).
- `intent/03-architecture-stack.md`가 이미 "**교체 가능한 모듈**: Separator... 인터페이스"라고 명시해뒀으므로, 이 함수 시그니처 자체가 인터페이스 역할(클래스 추상화는 지금 구현체가 1개뿐이라 과한 설계로 판단 — Codex 의견 받아볼 지점).

### 2. `POST /songs/audio` (`api/songs.py` 또는 신규 `api/songs_audio.py`)
- **인증**: `user: User = Depends(get_current_user)` — 기존 `POST /songs`와 동일(모드C C-004 반영). `Song.user_id`·`Job.user_id` 모두 `user.id`로 생성.
- 입력: `file`(음원), `title`, `artist`(선택). DrumScore 없음(아직 채보 전).
- 확장자 검증: `.mp3/.wav/.m4a/.flac`(REQ-01 입력 명시 그대로) — 기존 `ALLOWED_EXTENSIONS`와 별도 맵(디지털 악보용과 섞으면 `meta.source` 매칭 로직이 깨짐).
- 크기 상한: 기존 20MB(디지털 악보용)는 음원엔 너무 작음(3~5분 음원은 수십 MB) — **100MB**로 별도 상한(내 판단, REQ-01에 수치 명시 없음 — 디스크 보호 목적).
- **업로드 쓰기 방식(모드C C-005 반영)**: T2-5처럼 청크를 리스트에 모았다 합치지 않고, 임시 파일에 청크를 바로 이어 쓴다(`song_storage_dir()`+uuid 임시 파일명, `write_song_file`과 같은 원자적 `Path.replace()` 패턴을 공유하는 새 헬퍼 `write_song_file_streaming(song_id, fixed_filename, chunks: Iterable[bytes]) -> str` 추가 — 100MB를 메모리에 두 번 들고 있지 않음). 상한 초과 시 즉시 중단(T2-5와 동일하게 전체를 다 읽지 않음).
- 처리: `Song(source_type=AUDIO, status=PENDING)` 생성 → 위 스트리밍 쓰기로 원본 저장 → `Asset(kind=ORIGINAL)` → `Job(job_type=SEPARATE, status=QUEUED)` 생성, 전부 한 트랜잭션. 실패 시 T2-5와 동일하게 파일+DB 롤백.
- 응답: `{song: SongOut, job_id: int}`.

### 3. `worker/handlers.py`에 `separate_handler(job: Job) -> None` 등록

**최종 통합 절차(모드C 1~3차 지적을 전부 반영한 확정 의사코드 — 아래가 구현 기준, 위 라운드별 절은 변경 이력으로 남김)**:

```python
def separate_handler(job: Job) -> None:
    db = <job가 속한 세션>
    song = db.get(Song, job.song_id)
    song.status = SongStatus.PROCESSING
    db.commit()                                    # (1) 처리중 상태 노출

    original_path = resolve_asset_path(<ORIGINAL Asset의 file_path>)
    temp_dir = Path(tempfile.mkdtemp())
    try:
        start = time.monotonic()
        stems = demucs_separator.separate(original_path, temp_dir)   # 실패 시 예외 던짐
        logger.info("separate song=%s elapsed=%.1fs", song.id, time.monotonic() - start)

        written: list[str] = []
        try:
            for name, stem_path in stems.items():
                rel_path = write_song_file(song.id, f"stem_{name}.wav", stem_path.read_bytes())
                written.append((name, rel_path))
            for name, rel_path in written:
                db.add(Asset(song_id=song.id, kind=ASSET_KIND_MAP[name], file_path=rel_path))
            song.status = SongStatus.COMPLETED
            db.commit()                             # (2) 쓰기 4개 + Asset 4개 + Song.COMPLETED, 전부 이 한 블록 안
        except Exception:
            db.rollback()                           # 커밋 전이므로 Asset 쪽은 지울 게 없음
            for _, rel_path in written:
                p = resolve_asset_path(rel_path)
                if p is not None:
                    p.unlink(missing_ok=True)        # 이번 시도에서 쓴 stem만, ORIGINAL은 안 건드림
            song.status = SongStatus.FAILED
            db.commit()                             # (3) Song 실패 반영
            raise                                    # _run_job이 Job 쪽을 FAILED로 마무리
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)  # 성공·실패 모든 경로에서 임시 출력 정리(C-003)
```

- (1)~(3)에서 "쓰기 실패"와 "Asset INSERT/commit 자체의 실패"가 **같은 `try/except` 블록**(위 의사코드의 안쪽 `try`) 안에 있으므로, 어느 쪽이 실패하든 정리 경로가 동일하게 실행된다(모드C 2차 C-011이 지적한 "본문 절차에 명시 안 됨" 문제를 의사코드로 직접 해소).
- (3)의 `db.commit()`(Song.FAILED 반영) 자체가 실패하는 극히 드문 경우(DB 연결 끊김 등)는 아래 "3-2"의 `_run_job` 레벨 안전망이 별도로 커버한다 — 핸들러 자신이 모든 실패를 완벽히 막으려 들지 않고, 공통 계층에 최후 방어선을 둔다(모드C 3차 BLOCKING 지적에 대한 최종 결정, 아래 "마스터 최종 판단" 참조).

### 3-1. `worker/runner.py`의 `recover_orphaned_jobs()` 확장(모드C C-001 반영)
워커 프로세스가 Demucs 실행 도중 강제 종료되면 핸들러의 except가 전혀 실행되지 못해 Song이 PROCESSING에 영원히 멈출 수 있음 — 이 함수가 Job을 FAILED로 되돌릴 때, 그 Job의 Song도 같이 조회해 `status == PROCESSING`이면 `FAILED`로 맞춘다. job_type에 상관없이 범용 로직으로 둬서(SEPARATE 전용 분기 없이), 앞으로 생길 TRANSCRIBE 등 다른 핸들러도 같은 Song.status=PROCESSING 패턴을 쓰면 자동으로 이 복구 혜택을 받는다. **이 함수는 "워커가 죽어서 Job이 PROCESSING에 멈춘" 경우만 커버한다 — "Job은 정상적으로 FAILED까지 끝났는데 그 와중에 Song 쪽 커밋만 실패한" 경우는 다루지 않는다(그건 Job이 이미 PROCESSING이 아니라서 이 함수의 조회 대상에서 애초에 빠짐). 그 간극은 3-2에서 별도로 닫는다.**

### 3-2. `worker/runner.py`의 `_run_job()`에 Song 상태 동기화 안전망 추가(모드C 3차 BLOCKING 지적 반영, 신규)
Codex 모드C 3차(2026-10-25)가 지적한 잔여 간극: `separate_handler`가 "Song.status=FAILED" 커밋 자체에 실패하면(예: 그 순간 DB 연결이 끊김), 예외는 재발생하므로 `_run_job`이 **Job**은 정상적으로 FAILED 처리하지만, **Song**은 PROCESSING에 남을 수 있다 — 그리고 `recover_orphaned_jobs()`는 `Job.status==PROCESSING`만 보므로(3-1 참조) 이 Job은 이미 FAILED라 복구 대상이 아니다. 즉 "Job은 실패로 끝났다고 보여주는데 Song은 영원히 처리중"이라는 사용자 눈에 보이는 불일치가 남을 수 있음 — 이번 3차가 정확히 짚은 지점.

**해결**: `_run_job()`이 Job 상태를 COMPLETED/FAILED로 확정한 직후, **공통 안전망으로 Song 상태를 Job 결과와 강제로 맞춘다** — 핸들러별로 각자 안전망을 중복 구현하지 않고 한 곳에 둔다(향후 TRANSCRIBE 등 다른 핸들러도 자동으로 같은 보호를 받음):

```python
def _run_job(db: Session, job: Job) -> None:
    handler = get_handler(job.job_type)
    if handler is None:
        job.status = JobStatus.FAILED
        job.error_message = f"'{job.job_type.value}' 처리 로직이 아직 구현되지 않았습니다"
        job.completed_at = utcnow_naive()
        db.commit()
        return

    try:
        handler(job)
        job.status = JobStatus.COMPLETED
    except Exception as exc:
        job.status = JobStatus.FAILED
        job.error_message = str(exc)[:2000]
    job.completed_at = utcnow_naive()
    db.commit()

    _sync_song_status_with_job(db, job)   # 신규 — 아래


def _sync_song_status_with_job(db: Session, job: Job) -> None:
    """핸들러가 Song.status를 스스로 맞추는 게 기본 경로지만, 그 커밋 자체가
    실패하는 극히 드문 경우를 대비한 최종 안전망. Job이 끝난 상태(COMPLETED/FAILED)와
    Song이 아직 PROCESSING이면 Job 쪽으로 강제 동기화한다 — Job이 COMPLETED인데
    Song이 PROCESSING이면 핸들러가 Asset 커밋 직전에 멈춘 비정상 상태이므로 이 경우는
    안전하게 FAILED로 맞춘다(핸들러가 '성공'을 Song에 못 남겼으므로 실제로 쓸 수 있는
    산출물이 있다고 보장 못 함 — COMPLETED로 낙관하지 않는다)."""
    song = db.get(Song, job.song_id)
    if song is None or song.status != SongStatus.PROCESSING:
        return
    if job.status == JobStatus.FAILED:
        song.status = SongStatus.FAILED
        db.commit()
    elif job.status == JobStatus.COMPLETED:
        # 핸들러가 성공 경로에서 Song.COMPLETED를 직접 커밋하지 못했다는 뜻이므로
        # 낙관적으로 COMPLETED를 선언하지 않고 FAILED로 둔다(위 docstring 설명).
        song.status = SongStatus.FAILED
        db.commit()
```

이 안전망은 **정상 흐름에서는 항상 no-op**(핸들러가 이미 Song.status를 맞춰놔서 `song.status != PROCESSING` 조건에서 바로 반환)이고, 핸들러 자신의 Song 커밋이 실패하는 희귀 케이스에서만 작동한다.

### 4. 의존성
`app/server/.venv`에 `torch`/`torchaudio`(cu128)/`demucs`/`numpy` 추가 설치 필요 — 지금까지 Demucs는 프로젝트 루트 `.venv`(T0-1/T0-2 스파이크 전용)에만 있고 실제 서버 프로세스가 쓰는 `app/server/.venv`엔 없음(확인됨). `requirements.txt`에 추가.

## 위험 분류·Codex 검수
"공개 API 변경"(새 업로드 엔드포인트) + "외부 모델 연동"(서브프로세스로 Demucs 실행, 임의 처리시간 수 초~수십 초) = **위험 작업**(`intent/06-pipeline.md` §1-1). 구현 전 Codex 모드C 설계 검수 진행.

### 모드C 1차 지적 반영(2026-10-25)
**필수(C-001~004)**:
- **C-001(워커 강제종료 시 Song 상태)**: `recover_orphaned_jobs()`가 PROCESSING으로 멈춘 Job을 FAILED로 되돌릴 때, 그 Job의 Song도 함께 조회해 `status == PROCESSING`이면 `FAILED`로 맞춘다(핸들러의 except가 전혀 실행되지 못하고 프로세스가 죽는 경우를 커버 — 이 로직은 job_type에 상관없이 범용으로 두어 T3-2(TRANSCRIBE) 등 이후 작업도 같은 패턴을 따르면 자동으로 혜택받음).
- **C-002(부분 stem 기록 실패 시 정리)**: 4개 stem을 전부 디스크에 쓴 뒤에만 Asset 4개를 한 트랜잭션으로 커밋한다(쓰기와 DB 반영을 분리). 쓰기 도중 하나라도 실패하면, **이번 시도에서 이미 쓴 stem 파일들만**(`resolve_asset_path()`로 경로를 얻어 직접 `unlink`) 지우고 — `ORIGINAL` 에셋·원본 파일은 절대 안 건드림(`delete_song_files()`는 곡 전체를 지우므로 여기선 쓰지 않음) — `Song.status=FAILED` 커밋 후 재발생. 재시도(같은 작업 재실행) 기능은 현재 없음(Q-17과 같은 전제, 범위 밖)이라 "실패한 작업은 그대로 FAILED로 남고, 사용자가 다시 업로드해야 함"을 이번 범위의 정책으로 명시.
- **C-003(임시 출력 디렉터리 정리 보장)**: Demucs 실행 직후부터 `try/finally`로 감싸 `shutil.rmtree(temp_dir, ignore_errors=True)`를 **성공·실패 모든 경로에서** 실행(핸들러 함수 전체가 아니라 "Demucs 임시 출력 디렉터리가 생성된 시점 이후"부터 감쌈).
- **C-004(인증·소유권 명시)**: `POST /songs/audio`는 기존 `POST /songs`와 동일하게 `user: User = Depends(get_current_user)`를 받고, `Song.user_id=user.id`·`Job.user_id=user.id`로 생성 — 다른 엔드포인트와 동일한 소유권 경계(T1-3/T2-5 패턴 그대로, 새 예외 없음).

**권장(C-005~007) 반영 여부**:
- **C-005(메모리, 반영)**: 청크를 리스트에 모았다 `b"".join()`하는 대신, **고정 임시 파일에 청크 단위로 바로 써나가는** 방식으로 변경 — `song_storage_dir()`+uuid 임시 파일명 패턴(`file_storage.write_song_file`과 같은 원자적 교체)을 재사용하되, 전체 내용을 메모리에 들고 있지 않고 디스크로 스트리밍. 100MB 업로드에서 메모리 사용이 사실상 입출력 버퍼 수준으로 줄어듦.
- **C-006(단일 워커가 분리 동안 블로킹, 의도된 전제로 기록)**: Q-17이 이미 "워커는 1개만 운영"을 전제로 깔아뒀고, 의뢰인 규모(Q-07: 최대 6명, 보통 동시 사용 적음)에서 분리 작업 1건당 수십 초(실측 18~23초, 아래 QA 증거)가 뒤 작업을 지연시키는 건 **이번 범위에서는 수용 가능한 트레이드오프**로 명시(설계 변경 안 함) — 동시 사용자가 늘어나 문제가 되면 Phase 5급 재설계(워커 여러 개+Job 소유권, Q-17이 이미 그 전제 조건으로 등록해둠) 필요.
- **C-007(확장자만 검사, 그대로 둠)**: 매직바이트 검증은 추가 안 함 — 확장자와 실제 내용이 달라도 Demucs/ffmpeg 처리 시점에 실패하며, 그 실패는 C-001~003의 실패 경로(Song.status=FAILED+Job.error_message)로 이미 정상 처리됨. 개인 규모 도구에서 매직바이트 검사는 과한 설계로 판단(범위 밖).

**확인 필요(C-008~010) 응답**:
- C-008: Demucs stderr는 업로드한 **본인**만 볼 수 있는 `GET /jobs/{id}`로만 노출(다른 사용자 차단은 기존 404 패턴 그대로) — 교차 사용자 유출 아님, 길이 상한은 `runner.py`가 이미 2000자로 범용 처리. 추가 조치 없음.
- C-009/C-010: Song 실패 커밋 자체가 실패하는 경우(DB 연결 끊김 등)의 복구는 이번 범위에서 다루지 않음(T2-5도 같은 수준 — 극히 드문 경우에 대한 추가 복구 로직은 과설계로 판단, 명시적으로 범위 밖 기록).

### 모드C 2차 지적 반영(2026-10-25)
**필수(C-011)**: 1차 반영 설명이 "stem **쓰기** 도중 실패"만 정리 대상으로 읽혔던 것을 명확히 함 — **"4개 파일 쓰기 ~ Asset 4개 커밋"을 하나의 실패 처리 범위로 묶는다.** 즉 (a) 파일 쓰기 중 실패했든, (b) 4개 전부 쓰기엔 성공했지만 `Asset` INSERT나 `db.commit()` 자체가 실패했든 — 두 경우 모두 "이번 시도에서 실제로 디스크에 쓴 stem 파일들만" 직접 `unlink`로 정리하고(DB 커밋이 전혀 안 됐으므로 Asset 쪽은 애초에 지울 게 없음 — DB 세션은 `db.rollback()`), `Song.status=FAILED`를 별도 커밋한 뒤 예외를 재발생시킨다. `ORIGINAL` 파일·에셋은 두 경우 다 정리 대상에서 제외(기존 1차 반영과 동일 원칙, 범위만 명확화).

**권장(C-012, C-013) 반영**:
- C-012: `write_song_file_streaming()`은 `write_song_file()`과 **똑같은 보장**을 그대로 따른다 — (1) 같은 디렉터리에 요청별 고유 임시 파일명(`<fixed_filename>.<uuid4>.tmp`)으로 먼저 쓰고, (2) 전체 청크를 다 쓴 뒤에만 `Path.replace()`로 원자적 교체, (3) 어느 단계에서든 예외가 나면 `finally`에서 임시 파일을 `unlink(missing_ok=True)` — 차이는 오직 "content: bytes 매개변수 하나를 한 번에 쓴다" 대신 "청크 이터러블을 받아 임시 파일에 순차적으로 쓴다"는 점뿐, 원자성·정리 보장은 완전히 동일. 100MB 상한 초과로 중단되는 경우도 **아직 최종 파일로 교체(`replace`)하기 전**이라 불완전한 `original<ext>`가 남지 않는다(임시 파일만 생성됐다 `finally`에서 지워짐).
- C-013: 정상 흐름에서는 Song이 PROCESSING인 동안 그 Song을 가리키는 SEPARATE Job은 항상 정확히 1개가 PROCESSING 상태다(`separate_handler`가 Job을 선점한 직후 Song.status=PROCESSING으로 맞추고, 핸들러가 끝날 때(성공/처리된 실패 모두) 둘 다 동시에 terminal 상태로 전이함 — 설계상 "Song은 PROCESSING인데 그걸 가리키는 Job이 이미 terminal"이거나 "Job 자체가 없다"는 상태는 정상 경로로는 발생하지 않는다는 전제를 명시). 따라서 `recover_orphaned_jobs()`가 `Job.status==PROCESSING`만 조회 대상으로 삼아도 C-001이 노린 "워커 강제종료" 케이스를 전부 커버함 — 조회 조건 확장은 불필요.

### 마스터 최종 판단(모드C 3차 BLOCKING, `intent/06-pipeline.md` §1-1 "최대 3회" 규칙 적용)
Codex 모드C 3차 검수가 BLOCKING으로 돌아옴 — `intent/06-pipeline.md`의 "모드B/C는 최대 3회, 그 이후에도 미해결이면 마스터가 자체 최종 검증 후 병합 여부를 결정하고 사유를 문서화" 규칙에 따라 4차 라운드를 보내지 않고 여기서 직접 판단한다.

**지적이 유효한가**: 그렇다. 2차 반영 때 "Asset 커밋 실패도 같은 정리 경로로 묶는다"고 **서술**했지만 §3 본문엔 그걸 보여주는 절차나 의사코드가 없어 구현자가 서술과 다르게 짤 여지가 실제로 있었음 — 문서 정밀도 문제가 맞다. 또한 "Song 실패 커밋 자체가 실패하면?"이라는 재귀적 질문도, 1차 때 "범위 밖"으로 치부했던 것과 달리 **`recover_orphaned_jobs()`가 이 경우를 커버하지 못한다는 구체적 근거**(Job이 이미 FAILED라 그 함수의 조회 대상이 아님)까지 제시해 막연한 우려가 아니라 설계상 실제 구멍임을 보여줬다.

**어떻게 닫았는가**: 위 §3을 "라운드별 서술"에서 "하나의 확정 의사코드"로 다시 썼고(C-011 간극을 구조적으로 해소), §3-2에 `_run_job()` 레벨의 공용 안전망(`_sync_song_status_with_job`)을 신규로 추가해 "핸들러의 Song 커밋 자체가 실패"하는 경우까지 닫았다 — 이건 Codex가 제안한 범위보다 한 단계 더 일반적인 해법(핸들러마다 각자 안전망을 두지 않고 공통 계층에 1곳만 둠, 향후 TRANSCRIBE 등도 자동 혜택).

**왜 4차 라운드를 안 보냈는가**: 반영한 두 가지(의사코드 명문화, 공용 안전망 추가)는 이미 1~3차에서 다뤄진 설계 원칙(원자적 쓰기, 실패 시 정리 범위, Song/Job 상태 동기화)의 **조합·명확화**일 뿐 새로운 미지수가 아니라고 판단했다 — 서술이 아니라 실행 가능한 의사코드로 적었으므로 구현 단계에서 그대로 옮기면 되고, 이 이상의 반복 검수는 수확 체감이라고 판단(토큰 낭비 금지 원칙, CLAUDE.md §1-5). 구현 후 Codex 모드A(코드 자체 검수)에서 이 로직이 실제로 의사코드와 일치하는지 다시 한번 확인받는다.

## 테스트 전략
- `modules/separator/`: 실제 Demucs 서브프로세스 호출은 pytest 단위 테스트로 매번 돌리기엔 느림(GPU 분리 자체는 T0-1에서 이미 22.76초로 측정됨) — 커맨드 조립·stdout/stderr 파싱·에러 처리는 subprocess를 monkeypatch해 단위 테스트, **실제 Demucs 1회 실행은 QA 증거로 별도 기록**(진짜 음원 1개로).
- `worker/handlers.py`의 `separate_handler`: `demucs_separator.separate`를 monkeypatch해 성공/실패 양쪽 경로를 pytest로 검증(Song.status 전이, Asset 4개 생성, 실패 시 Song.status=FAILED+Job.error_message). stem 쓰기 4개 중 일부만 성공 후 Asset 커밋 단계에서 실패시키는 시나리오(C-011)도 monkeypatch로 재현해 "이번 시도에서 쓴 stem만 정리, ORIGINAL은 안 건드림"을 직접 증명.
- `worker/runner.py`의 `_sync_song_status_with_job`: Song.status를 일부러 PROCESSING으로 둔 채(핸들러의 Song 커밋이 "실패"했다고 가정) `_run_job`을 돌려, Job이 FAILED/COMPLETED로 끝났을 때 Song이 강제로 FAILED로 동기화되는지 pytest로 검증(모드C 3차 지적에 대한 직접 회귀 테스트).
- `api/songs.py`의 `POST /songs/audio`: TestClient로 업로드 → Song/Asset(ORIGINAL)/Job(QUEUED) 생성 확인, 확장자 거부, 크기 상한 조기 중단(T2-5와 같은 패턴 재사용).
- **실제 음원 end-to-end**: 의뢰인이 `음원/` 폴더에 넣어준 실제 파일(`.gitignore` 대상, 레포에 커밋 안 함) 또는 MDB Drums 데이터셋 트랙으로 업로드→워커 1회 실행→4개 stem 파일 생성·재생 가능(soundfile로 로드 검증)까지 실측.

## 가정·확인 필요
- 영상 파일(mp4) 입력은 REQ-01에 명시 안 됨(mp3/wav/m4a/flac만) — Demucs가 내부적으로 ffmpeg를 거쳐 어떤 컨테이너든 읽을 수 있는 구조임은 설치된 버전 소스(`audio.py`)로 확인했지만, **업로드 API의 확장자 허용 목록엔 mp4를 넣지 않는다**(범위 밖 작업 금지 — 명시 안 된 입력 형식 확장은 제안만). 의뢰인이 준 mp4는 이번 업로드 API 경로가 아니라 **별도 스크립트로 직접 Demucs에 넣어 분리 모듈 자체의 동작을 검증하는 용도**로만 쓴다.
- ffmpeg: 이번 세션에서 winget으로 설치함(이 PC 전역) — Demucs의 ffmpeg 서브프로세스 호출이 실제로 동작하는지 QA에서 재확인.
