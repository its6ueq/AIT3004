import os
import shutil
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from deepface import DeepFace

import models
import database
import security
from database import get_db

app = FastAPI(title="Face Recognition Attendance API")

origins = ["http://localhost", "http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

IMAGE_DB_PATH = Path("database/images")
IMAGE_DB_PATH.mkdir(parents=True, exist_ok=True)

class StudentResponse(BaseModel):
    id: int
    student_code: str
    name: str
    class Config:
        orm_mode = True

class AttendanceLogResponse(BaseModel):
    timestamp: datetime
    class Config:
        orm_mode = True
        
class AdminLoginRequest(BaseModel):
    username: str
    password: str

class AttendanceRequest(BaseModel):
    student_code: str

@app.on_event("startup")
def on_startup():
    max_retries = 5
    retries = 0
    while retries < max_retries:
        try:
            database.engine.connect()
            print("Database connection established successfully.")
            print("Creating database tables if they don't exist...")
            models.Base.metadata.create_all(bind=database.engine)
            print("Tables created successfully.")
            return
        except Exception as e:
            retries += 1
            print(f"Failed to connect or create tables. Retrying ({retries}/{max_retries})... Error: {e}")
            time.sleep(5)
    print("Could not connect to the database after several retries. Exiting.")
    exit(1)

@app.get("/")
def read_root():
    return {"message": "Welcome to the Face Recognition Attendance System API"}

@app.post("/api/admin/login")
def login_admin(request: AdminLoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter(models.Admin.username == request.username).first()
    if not admin or not security.verify_password(request.password, admin.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"message": "Đăng nhập thành công"}

@app.get("/api/students", response_model=List[StudentResponse])
def get_all_students(db: Session = Depends(get_db)):
    students = db.query(models.Student).all()
    return students

@app.post("/api/students", status_code=status.HTTP_201_CREATED)
def register_student(
    name: str = File(...),
    student_code: str = File(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    if db.query(models.Student).filter(models.Student.student_code == student_code).first():
        raise HTTPException(status_code=400, detail="Mã sinh viên đã tồn tại")

    file_path = IMAGE_DB_PATH / f"{student_code}_{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_student = models.Student(
        name=name,
        student_code=student_code,
        reference_image_path=str(file_path)
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)
    return {"message": f"Sinh viên {name} đã được đăng ký thành công.", "student": new_student}

@app.delete("/api/students/{student_code}", status_code=status.HTTP_200_OK)
def delete_student(student_code: str, db: Session = Depends(get_db)):
    db_student = db.query(models.Student).filter(models.Student.student_code == student_code).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên")

    try:
        if db_student.reference_image_path and os.path.exists(db_student.reference_image_path):
            os.remove(db_student.reference_image_path)
            print(f"Removed image file: {db_student.reference_image_path}")
    except Exception as e:
        print(f"Error removing image file: {e}")

    db.delete(db_student)
    db.commit()
    return {"message": f"Sinh viên có mã {student_code} đã được xóa thành công."}

@app.post("/api/attendance", status_code=status.HTTP_201_CREATED)
def record_attendance(request: AttendanceRequest, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.student_code == request.student_code).first()
    if not student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên.")

    system_time = datetime.now()

    latest_log = db.query(models.AttendanceLog)\
                     .filter(models.AttendanceLog.student_id == student.id)\
                     .order_by(models.AttendanceLog.timestamp.desc()).first()

    if latest_log and (system_time - latest_log.timestamp < timedelta(hours=1)):
        return {"message": "Đã điểm danh gần đây, không cần ghi lại."}

    new_log = models.AttendanceLog(
        student_id=student.id, 
        status="PRESENT", 
        timestamp=system_time
    )
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    return new_log

@app.get("/api/attendance/{student_code}", response_model=list[AttendanceLogResponse])
def get_attendance_history(student_code: str, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.student_code == student_code).first()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sinh viên.")

    logs = db.query(models.AttendanceLog)\
             .filter(models.AttendanceLog.student_id == student.id)\
             .order_by(models.AttendanceLog.timestamp.desc())\
             .limit(5)\
             .all()
    
    return logs[::-1]

@app.post("/api/recognize")
def recognize_face(file: UploadFile = File(...), db: Session = Depends(get_db)):
    temp_dir = Path("temp")
    temp_dir.mkdir(exist_ok=True)
    temp_file_path = temp_dir / file.filename
    with open(temp_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        dfs = DeepFace.find(
            img_path=str(temp_file_path),
            db_path=str(IMAGE_DB_PATH),
            model_name='SFace',
            distance_metric='cosine',
            enforce_detection=False
        )
        if not isinstance(dfs, list) or not dfs or dfs[0].empty:
            raise HTTPException(status_code=404, detail="Không tìm thấy khuôn mặt nào khớp.")

        best_match = dfs[0].iloc[0]
        identity_path = Path(best_match['identity'])
        student_code = identity_path.stem.split('_')[0]
        student = db.query(models.Student).filter(models.Student.student_code == student_code).first()

        if not student:
            raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên trong database.")
        
        return {"student_name": student.name, "student_code": student.student_code}
    except Exception as e:
        print(f"Error during recognition: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)