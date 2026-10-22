import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.core.database import engine, Base, SessionLocal
from app.models.user import User
from app.core.security import hash_password

from app.core import config

def seed_users():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    operator_password = config.DEMO_OPERATOR_PASSWORD
    viewer_password = config.DEMO_VIEWER_PASSWORD

    operator_user = db.query(User).filter(User.username == "operator").first()
    if not operator_user:
        operator_user = User(
            username="operator",
            password_hash=hash_password(operator_password),
            role="operator"
        )
        db.add(operator_user)
        print(f"Created Operator User. Username: operator, Password: {operator_password}")
    else:
        print("Operator user already exists.")

    viewer_user = db.query(User).filter(User.username == "viewer").first()
    if not viewer_user:
        viewer_user = User(
            username="viewer",
            password_hash=hash_password(viewer_password),
            role="viewer"
        )
        db.add(viewer_user)
        print(f"Created Viewer User. Username: viewer, Password: {viewer_password}")
    else:
        print("Viewer user already exists.")

    db.commit()
    db.close()

if __name__ == "__main__":
    print("Seeding database...")
    seed_users()
    print("Seeding completed.")
