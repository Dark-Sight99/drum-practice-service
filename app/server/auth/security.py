"""비밀번호 해시 + 세션 토큰. 근거: intent/03-architecture-stack.md §3, REQ-08.

API는 실제 설치된 argon2-cffi를 실행해 확인함(.hash()/.verify(), 불일치 시 VerifyMismatchError) —
기억에 의존하지 않음(CLAUDE.md 절대규칙 2).
"""

import hashlib
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()


def utcnow_naive() -> datetime:
    """SQLite는 타임존 정보를 보존하지 않는다(실행으로 확인) — DB에 저장·비교하는 모든 시각은
    "naive datetime인데 값은 항상 UTC"로 이 함수를 통해서만 만든다."""
    return datetime.now(UTC).replace(tzinfo=None)


def hash_password(raw_password: str) -> str:
    return _hasher.hash(raw_password)


def verify_password(password_hash: str, raw_password: str) -> bool:
    try:
        return _hasher.verify(password_hash, raw_password)
    except VerifyMismatchError:
        return False


def generate_session_token() -> str:
    """쿠키에 담을 무작위 토큰. DB에는 이 값 자체가 아니라 해시만 저장한다."""
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """토큰을 DB에 저장할 때 쓰는 해시. 비밀번호가 아니라 이미 32바이트 난수라 SHA-256으로 충분하다
    (느린 해시(argon2)가 필요한 건 사람이 고르는 저엔트로피 비밀번호 쪽)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
