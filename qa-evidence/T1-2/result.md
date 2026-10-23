> 한 줄 요약: T1-2 QA — ruff/pytest 16개 전부 통과(모델 CRUD, FK/unique/복합FK/CHECK 제약 — 상대경로 조작·절대경로·UNC 전부 포함, alembic 마이그레이션 실제 적용, enum 저장값·Codex 지적 회귀 테스트 포함).

# T1-2 QA 결과(2026-10-23, Codex 모드A·모드B 반영 후 최종)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| lint | `ruff check .` | PASS (지적 0건) |
| test | `pytest -v` | PASS (16/16) |

## 테스트 목록과 의미
| 테스트 | 확인하는 것 |
|---|---|
| `test_health` | T1-1에서 만든 기존 엔드포인트(회귀 확인) |
| `test_alembic_upgrade_head` | `alembic upgrade head`를 임시 DB에 실제로 실행해 5개 테이블 + `alembic_version` 생성 확인(마이그레이션 자체가 동작하는지) |
| `test_create_user` | User 생성, 기본값(`is_active=True`) 확인 |
| `test_duplicate_username_rejected` | `username` unique 제약 위반 시 `IntegrityError` 확인(REQ-08 분리 전제조건) |
| `test_song_belongs_to_user` | Song-User FK·역참조 확인, 기본 status/needs_review 값 확인 |
| `test_asset_cascade_delete_with_song` | Song 삭제 시 연결된 Asset도 같이 삭제(cascade) 확인 |
| `test_enum_columns_store_lowercase_value_not_member_name` | **실제 버그 발견·수정 검증**: SQLAlchemy Enum 기본 동작은 `.name`(예 "PENDING")을 저장하는데, `values_callable`로 `.value`(예 "pending")를 저장하도록 바꾼 설정이 실제로 적용되는지 SQL로 직접 조회해 확인 |
| `test_job_queue_per_user` | REQ-10 다중 사용자 큐 분리: `user_id`로 필터링 시 다른 사용자 작업이 안 섞이는지 확인 |
| `test_practice_setting_one_to_one` | PracticeSetting의 `song_id` unique 제약(1곡=설정 1개) 확인 |

전체 로그: `raw_log.txt`

## Codex 모드A 반영 후 테스트 (신규 4개)
| 신규 테스트 | 확인하는 것 |
|---|---|
| `test_fk_violation_rejected_for_invalid_user` | C-001: FK 제약이 실제로 켜져 있는지(없는 user_id 거부) |
| `test_job_cannot_reference_another_users_song` | C-002: 복합 FK로 다른 사용자 곡 참조 작업 거부 |
| `test_asset_file_path_rejects_path_traversal` | C-003: `..` 경로 조작 문자열 거부 |
| (fixture 변경) | C-005: 테스트 엔진도 FK 검사 켜짐 |

## Codex 모드B 반영 후 테스트 (신규 4개, 총 16개)
| 신규 테스트 | 확인하는 것 |
|---|---|
| `test_asset_file_path_rejects_absolute_paths[/etc/passwd]` | C-007: 유닉스 절대경로 거부 |
| `test_asset_file_path_rejects_absolute_paths[C:\Windows\...]` | C-007: 윈도우 드라이브 절대경로 거부 |
| `test_asset_file_path_rejects_absolute_paths[\\fileserver\...]` | C-007: UNC 경로 거부 |
| `test_asset_file_path_accepts_relative_path` | 대조군: 정상 상대경로는 막히지 않음 |

## 수용 기준(T1-2) 충족 여부
- [x] 5개 테이블(users, songs, assets, jobs, practice_settings) 스키마 구현
- [x] REQ-07: songs에 제목/아티스트/원곡BPM/입력경로(source_type)/상태 컬럼, assets로 원본·분리트랙·DrumScore 저장 구조, practice_settings로 BPM/볼륨/루프 저장
- [x] REQ-08: songs/jobs에 user_id 포함, FK로 사용자별 분리 가능한 구조(실제 접근 제어는 T1-3)
- [x] REQ-10: jobs 테이블로 큐 표현, status(대기/처리중/완료/실패), user_id로 사용자별 조회 분리
