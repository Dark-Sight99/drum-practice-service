> 한 줄 요약: T1-3 QA — ruff/pytest 29개 전부 통과(로그인/세션/로그아웃/비로그인 차단/사용자간 격리/즉시 정지/관리자 전용 + Codex 지적 반영 회귀 테스트 포함).

# T1-3 QA 결과(2026-10-23, Codex 모드A 반영 후 최종)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| lint | `ruff check .` | PASS (지적 0건) |
| test | `pytest -v` | PASS (29/29, T1-3 신규 13개 + 기존 16개) |

## Codex 모드A 반영 후 테스트(신규 3개)
| 테스트 | 확인하는 것 |
|---|---|
| `test_login_failures_return_identical_response` | C-001: 사용자없음/비밀번호틀림/계정정지 응답이 상태코드·본문 전부 동일 |
| `test_tampered_session_token_rejected` | C-003: 변조된 세션 토큰 거부 |
| `test_session_token_stored_only_as_hash` | C-003: 쿠키 원문 토큰이 DB에 그대로 저장 안 됨(해시만) |

## 신규 테스트(T1-3)와 REQ-08 수용 기준 대응
| 테스트 | REQ-08 수용 기준 |
|---|---|
| `test_login_success_sets_httponly_cookie` | 로그인 성공 시 HttpOnly+Secure+SameSite=lax 쿠키 설정 확인 |
| `test_login_wrong_password_rejected` | (기본 동작) |
| `test_login_inactive_account_rejected` | 정지된 계정은 로그인 자체가 안 됨 |
| `test_protected_endpoint_requires_login` | **"로그인 없이는 어떤 곡 데이터에도 접근 불가"** — `/songs`, `/auth/me` 둘 다 401 |
| `test_cross_user_cannot_see_others_songs` | **"사용자 A가 사용자 B의 곡 라이브러리에 접근 불가"** — 목록엔 안 보이고 상세는 404(403 아님 — 존재 자체를 안 흘림) |
| `test_logout_invalidates_session` | 로그아웃 후 즉시 세션 무효화 |
| `test_suspend_existing_session_blocks_immediately` | **"관리자가 계정 정지 시 해당 계정은 즉시 로그인 불가"** — 이미 로그인된 상태에서도 정지 즉시 다음 요청부터 401 |
| `test_expired_session_rejected` | 세션 만료 처리 |
| `test_admin_can_create_and_suspend_user` | 관리자의 계정 생성·정지(가입 화면 없음) |
| `test_non_admin_cannot_access_admin_endpoints` | 관리자 전용 엔드포인트 접근 제어(403) |

전체 로그: `raw_log.txt`

## 수용 기준(REQ-08) 충족 여부
- [x] 로그인 없이는 어떤 곡 데이터에도 접근 불가(테스트로 증명)
- [x] 사용자 A가 사용자 B의 곡 라이브러리에 접근 불가(테스트로 증명)
- [x] 관리자가 계정을 정지하면 해당 계정은 즉시 로그인 불가(테스트로 증명 — 이미 발급된 세션도 즉시 차단됨)
- [x] 가입 화면 없음, 관리자가 계정을 직접 생성·정지(`POST/PATCH /admin/users`)
