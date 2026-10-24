> 한 줄 요약: Codex 모드A 2라운드 — 1차 REQUEST_CHANGES(필수 1건: 안전망 공통경로 누락, 권장 1건: 가짜 스트리밍) 전부 반영 후 2차 APPROVE.

## 1차 — REQUEST_CHANGES
**Target:** `task/T3-1-separator` vs `main`

- **[필수] C-001 — `worker/runner.py`**: `_run_job()`의 "핸들러 없음" 분기가 `_sync_song_status_with_job()` 호출 전에 조기 `return`해, 그 경로에선 새로 만든 Song 동기화 안전망이 전혀 작동하지 않음.
- **[권장] C-002 — `api/songs.py`**: 업로드 전체를 `chunks` 리스트에 모은 뒤에야 `write_song_file_streaming()`에 넘겨서, "스트리밍"이라는 이름과 달리 100MB까지 메모리에 그대로 쌓임.

## 반영
- `_run_job()`을 두 분기(핸들러 있음/없음)가 하나의 공통 종료 경로(`job.completed_at` 설정 → `db.commit()` → `_sync_song_status_with_job()`)로 합쳐지도록 재구성.
- `write_song_file_streaming()`을 `async def` + `AsyncIterable[bytes]`로 재설계해 청크가 도착하는 즉시 디스크에 쓰고, `max_bytes` 검사도 같은 루프 안에서 수행(`UploadTooLargeError`). `api/songs.py`는 `UploadFile.read()`를 비동기 제너레이터(`_iter_upload_chunks`)로 감싸 그대로 전달 — 메모리엔 항상 청크 1개(1MB)만.
- 회귀 테스트 4개 신규 추가(worker 안전망 1개, file_storage 스트리밍 3개).

## 2차 — APPROVE
**판정**: APPROVE, 지적 없음. `worker/runner.py`·`file_storage.py`·`api/songs.py` 전체(디프뿐 아니라)를 다시 읽어 두 수정이 실제로 의도대로 반영됐는지 확인 — 추가 문제 없음.

## 비고
테스트는 Codex가 직접 실행하지 않음 — 마스터가 `pytest`(107개 통과) + 실제 서버·워커·Demucs end-to-end(성공/실패 경로, 스트리밍 고정 포함)로 별도 확인(`result.md`).
