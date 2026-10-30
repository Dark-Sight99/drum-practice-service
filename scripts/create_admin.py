"""최초 관리자 계정을 만든다. 근거: intent/07-open-questions.md Q-21("최초 관리자 계정을
실제 운영 환경에서 어떻게 만들지(부트스트랩) — POST /admin/users는 관리자만 호출 가능한데
맨 처음엔 관리자 계정 자체가 없음(닭과 달걀)"), REQ-08("가입 화면 없음, 관리자가 계정을
직접 생성").

실행: `<app/server/.venv 파이썬> scripts/create_admin.py <아이디>`
(비밀번호는 인자로 주지 않으면 화면에 안 보이게 입력받음 — 셸 기록에 안 남게)

이미 있는 아이디면 만들지 않고 안내만 하고 끝낸다(기존 계정을 실수로 덮어쓰지 않음 —
비밀번호를 바꾸고 싶으면 관리자 화면의 "비밀번호 재설정" 또는 이 스크립트 대신
API를 직접 써야 함, 이 스크립트는 "맨 처음 관리자가 하나도 없을 때"만을 위한 것).
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SERVER_DIR

# db/auth 모듈이 app/server를 루트로 삼음(pyproject.toml pythonpath=["."]과 동일 전제)
sys.path.insert(0, str(SERVER_DIR))

from auth.security import hash_password  # noqa: E402
from db.models import User  # noqa: E402
from db.session import SessionLocal  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username", help="관리자 아이디")
    parser.add_argument("--password", help="비밀번호(생략하면 안전하게 입력받음)")
    args = parser.parse_args()

    password = args.password
    if not password:
        password = getpass.getpass("비밀번호: ")
        confirm = getpass.getpass("비밀번호 확인: ")
        if password != confirm:
            print("비밀번호가 서로 다릅니다 — 취소합니다.", file=sys.stderr)
            return 1
    if len(password) < 8:
        print("비밀번호는 8자 이상으로 해주세요.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == args.username).first()
        if existing is not None:
            print(
                f"'{args.username}' 계정이 이미 있습니다(관리자 여부: {existing.is_admin}) — "
                "새로 만들지 않습니다. 비밀번호를 바꾸려면 "
                "관리자 화면의 '비밀번호 재설정'을 쓰세요."
            )
            return 0

        user = User(
            username=args.username,
            password_hash=hash_password(password),
            is_admin=True,
        )
        db.add(user)
        db.commit()
        print(f"관리자 계정 '{args.username}'을(를) 만들었습니다.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
