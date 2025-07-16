import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Admin, Base
from security import hash_password

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")
if not SQLALCHEMY_DATABASE_URL:
    raise ValueError("Chưa thiết lập biến môi trường DATABASE_URL")

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

def create_first_admin():
    db = SessionLocal()
    try:
        existing_admin = db.query(Admin).filter(Admin.username == ADMIN_USERNAME).first()
        if existing_admin:
            print(f"Tài khoản admin '{ADMIN_USERNAME}' đã tồn tại.")
            return

        hashed_pass = hash_password(ADMIN_PASSWORD)

        new_admin = Admin(username=ADMIN_USERNAME, hashed_password=hashed_pass)
        db.add(new_admin)
        db.commit()
        print(f"Tạo tài khoản admin '{ADMIN_USERNAME}' thành công!")

    finally:
        db.close()

if __name__ == "__main__":
    print("Bắt đầu tạo tài khoản admin đầu tiên...")
    Base.metadata.create_all(bind=engine)
    create_first_admin()