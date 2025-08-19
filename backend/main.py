import os
import shutil
from pathlib import Path
from datetime import datetime, timedelta, date
from typing import List, Optional  

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status, Form 
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Date

from pydantic import BaseModel
from deepface import DeepFace
from jose import JWTError, jwt
from fastapi.security import OAuth2PasswordBearer 

import uuid
import requests
import logging
import models
import database
import security
from models import Base, Teacher, Classroom, Student, AttendanceLog 
from database import get_db, SessionLocal, engine

from google import generativeai as genai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/teacher/login")

class TokenData(BaseModel):
    username: Optional[str] = None
    
class AdminLoginRequest(BaseModel):
    username: str
    password: str

class TeacherLoginRequest(BaseModel):
    username: str
    password: str

class ClassroomCreate(BaseModel):
    name: str

class TeacherCreate(BaseModel):
    username: str
    password: str
    classroom_id: int

class ClassroomResponse(BaseModel):
    id: int
    name: str
    class Config:
        from_attributes = True

class TeacherResponse(BaseModel):
    id: int
    username: str
    classroom_id: int
    class Config:
        from_attributes = True

class StudentResponse(BaseModel):
    id: int
    student_code: str
    name: str
    class Config:
        from_attributes = True

class AttendanceLogResponse(BaseModel):
    id: int
    timestamp: datetime
    status: str
    class Config:
        from_attributes = True
        
class AttendanceLogDetailsResponse(BaseModel):
    id: int
    timestamp: datetime
    status: str
    student_name: str
    student_code: str
    class Config:
        from_attributes = True

class GeminiAnalysisRequest(BaseModel):
    api_key: str
    prompt: str
    classroom_id: int 

class AttendanceSummaryResponse(BaseModel):
    student_id: int
    student_code: str
    student_name: str
    on_time_count: int
    late_count: int
    absent_count: int
    
    present_rate: float        
    on_time_rate: float       
    late_rate: float          
    absent_rate: float
    
    total_scheduled_sessions: int 
    
class StudentUpdateRequest(BaseModel):
    name: str
    student_code: str
    
class DailyStatusLog(BaseModel):
    date: str
    status: str 
    check_in_time: Optional[str] = None

class StudentDetailsResponse(BaseModel):
    student_info: StudentResponse
    daily_logs: List[DailyStatusLog]
        
class PasswordConfirmationRequest(BaseModel):
    password: str
    
class ScheduleResponse(BaseModel):
    id: int
    class_date: date
    classroom_id: int
    class Config: from_attributes = True

class ScheduleCreate(BaseModel):
    class_date: date
    
class GridCell(BaseModel):
    status: str
    note: Optional[str] = None
    check_in_time: Optional[str] = None

class StudentGridData(BaseModel):
    student_id: int
    student_name: str
    student_code: str
    logs_by_date: dict[date, Optional[GridCell]]

class AttendanceGridResponse(BaseModel):
    scheduled_dates: List[date]
    attendance_data: List[StudentGridData]

class NoteUpdateRequest(BaseModel):
    student_id: int
    class_date: date
    note: str
    
class AdminClassroomCreate(BaseModel):
    name: str

class AdminTeacherCreate(BaseModel):
    username: str
    password: str
    classroom_id: int
    
def generate_daily_status_logs(student: models.Student, db: Session) -> List[dict]:
    schedules = db.query(models.Schedule)\
                  .filter(models.Schedule.classroom_id == student.classroom_id)\
                  .order_by(models.Schedule.class_date.desc())\
                  .all()
    
    first_log_per_day = {}
    for log in sorted(student.attendance_logs, key=lambda x: x.timestamp):
        log_date = log.timestamp.date()
        if log_date not in first_log_per_day:
            first_log_per_day[log_date] = log

    daily_statuses = []
    for schedule in schedules:
        class_date = schedule.class_date
        
        log_entry = first_log_per_day.get(class_date)
        
        if log_entry:
            log_timestamp = log_entry.timestamp
            on_time_threshold = log_timestamp.replace(hour=8, minute=5, second=0)
            status = "LATE" if log_timestamp > on_time_threshold else "PRESENT"
            check_in_time = log_timestamp.strftime('%H:%M:%S')
        else:
            status = "ABSENT"
            check_in_time = None
            
        daily_statuses.append({
            "date": class_date.strftime('%Y-%m-%d'),
            "status": status,
            "check_in_time": check_in_time
        })
        
    return daily_statuses


def get_current_teacher(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    session_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        username: str = payload.get("sub")
        session_id: str = payload.get("jti")
        if username is None or session_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    teacher = db.query(models.Teacher).filter(models.Teacher.username == username).first()
    if teacher is None:
        raise credentials_exception
    
    if teacher.current_session_id != session_id:
        raise session_exception
        
    return teacher

async def get_current_active_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        
        if username is None or role is None:
            raise credentials_exception

        if role == "admin":
            user = db.query(models.Admin).filter(models.Admin.username == username).first()
            if user is None:
                raise credentials_exception
            return user
            
        elif role == "teacher":
            session_id: str = payload.get("jti")
            if session_id is None:
                raise credentials_exception 

            user = db.query(models.Teacher).filter(models.Teacher.username == username).first()
            if user is None:
                raise credentials_exception
                
            if user.current_session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Phiên đăng nhập đã hết hạn hoặc không hợp lệ.",
                )
            return user
            
        else:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

@app.on_event("startup")
def on_startup():
    print("Application startup...")
    Base.metadata.create_all(bind=engine)
    print("Database tables checked/created.")

    db = SessionLocal()
    try:
        admin_username = "admin"
        if not db.query(models.Admin).filter(models.Admin.username == admin_username).first():
            hashed_pass = security.hash_password("1")
            new_admin = models.Admin(username=admin_username, hashed_password=hashed_pass)
            db.add(new_admin)
            print(f"Tạo tài khoản System Admin '{admin_username}' thành công!")

        classroom_id_to_check = 1
        classroom_name = f"Trạm Điểm Danh #{classroom_id_to_check}"
        classroom = db.query(Classroom).filter(Classroom.id == classroom_id_to_check).first()
        if not classroom:
            classroom = Classroom(id=classroom_id_to_check, name=classroom_name)
            db.add(classroom)
            db.flush()
            print(f"Tạo lớp học/trạm mặc định '{classroom_name}' với ID={classroom.id} thành công!")
        
        teacher_username = "teacher01"
        if not db.query(Teacher).filter(Teacher.username == teacher_username).first():
            hashed_pass = security.hash_password("1")
            new_teacher = Teacher(
                username=teacher_username,
                hashed_password=hashed_pass,
                classroom_id=classroom.id
            )
            db.add(new_teacher)
            print(f"Tạo tài khoản Teacher '{teacher_username}' (pass: '1') và gán vào lớp '{classroom.name}' thành công!")

        student_count = db.query(Student).filter(Student.classroom_id == classroom.id).count()
        if student_count == 0:
            print("Lớp học trống, tạo dữ liệu mẫu thực tế...")
            
            import random
            import string

            student_names = list(string.ascii_uppercase)
            created_students = []
            for i, name in enumerate(student_names):
                new_student = Student(
                    name=name,
                    student_code=f"ID{1001 + i}",
                    reference_image_path="placeholder.jpg",
                    classroom_id=classroom.id
                )
                db.add(new_student)
                created_students.append(new_student)
            
            db.flush() 
            print(f"Đã tạo {len(created_students)} sinh viên mẫu (A-Z).")

            today = (datetime.utcnow() + timedelta(hours=7)).date() 
            scheduled_dates = []
            for i in range(15 * 7): 
                current_date = today - timedelta(days=i)
                if current_date.weekday() == 2:
                    scheduled_dates.append(current_date)
                if len(scheduled_dates) >= 15:
                    break
            
            for class_date in scheduled_dates:
                db.add(models.Schedule(class_date=class_date, classroom_id=classroom.id))
            
            logger.info(f"Đã tạo lịch học cho {len(scheduled_dates)} buổi vào các ngày thứ Tư.")
            
            for class_date in scheduled_dates:
                for student in created_students:
                    rand_num = random.random()
                    if rand_num < 0.6:
                        hour, minute = 7, random.randint(30, 59)
                        base_time = datetime.combine(class_date, datetime.min.time())
                        check_in_time = base_time.replace(hour=hour, minute=minute)
                        db.add(AttendanceLog(student_id=student.id, timestamp=check_in_time))
                    elif rand_num < 0.8: 
                        hour, minute = 8, random.randint(6, 59)
                        base_time = datetime.combine(class_date, datetime.min.time())
                        check_in_time = base_time.replace(hour=hour, minute=minute)
                        db.add(AttendanceLog(student_id=student.id, timestamp=check_in_time, note="Đi muộn"))

            
            db.commit()
            logger.info("Đã tạo dữ liệu điểm danh ngẫu nhiên theo tỷ lệ mới (60-20-20).")

        db.commit()
        logger.info("Initial data seeding complete.")
        
    except Exception as e:
        logger.error(f"Lỗi trong quá trình khởi tạo dữ liệu: {e}")
        db.rollback() 
    
    finally:
        db.close() 
        print("Database session closed.")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Face Recognition Attendance System API"}

@app.post("/api/teacher/login") 
def login_teacher(request: TeacherLoginRequest, db: Session = Depends(get_db)):
    teacher = db.query(models.Teacher).filter(models.Teacher.username == request.username).first()
    if not teacher or not security.verify_password(request.password, teacher.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_data = {
        "sub": teacher.username,
        "classroom_id": teacher.classroom_id,
        "role": "teacher"
    }
    token = security.create_access_token(data=access_token_data)
    
    payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
    teacher.current_session_id = payload.get("jti")
    db.commit()
    
    return {"access_token": token, "token_type": "bearer", "user": {"username": teacher.username, "role": "teacher"}}

@app.post("/api/admin/login")
def login_admin(request: AdminLoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter(models.Admin.username == request.username).first()
    if not admin or not security.verify_password(request.password, admin.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu Admin không đúng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_data = {
        "sub": admin.username,
        "role": "admin" 
    }
    
    token = security.create_access_token(data={"sub": admin.username, "role": "admin"})
    
    return {"access_token": token, "token_type": "bearer", "user": {"username": admin.username}}

@app.get("/api/students", response_model=List[StudentResponse])
def get_all_students(current_teacher: models.Teacher = Depends(get_current_teacher), db: Session = Depends(get_db)):
    students = db.query(models.Student).filter(models.Student.classroom_id == current_teacher.classroom_id).all()
    return students

@app.post("/api/students", status_code=status.HTTP_201_CREATED, response_model=StudentResponse)
def register_student(
    name: str = Form(...),
    student_code: str = Form(...),
    file: UploadFile = File(...),
    current_teacher: models.Teacher = Depends(get_current_teacher), 
    db: Session = Depends(get_db)
):
    classroom_id = current_teacher.classroom_id
    existing_student = db.query(models.Student).filter_by(student_code=student_code, classroom_id=classroom_id).first()
    if existing_student:
        raise HTTPException(status_code=400, detail="Mã sinh viên đã tồn tại trong lớp này.")

    classroom_image_path = IMAGE_DB_PATH / str(classroom_id)
    classroom_image_path.mkdir(parents=True, exist_ok=True)
    
    file_path = classroom_image_path / f"{student_code}_{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_student = models.Student(
        name=name,
        student_code=student_code,
        reference_image_path=str(file_path),
        classroom_id=classroom_id
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)
    return new_student

@app.delete("/api/students/{student_code}", status_code=status.HTTP_200_OK)
def delete_student(
    student_code: str, 
    current_teacher: models.Teacher = Depends(get_current_teacher), 
    db: Session = Depends(get_db)
):
    db_student = db.query(models.Student).filter_by(
        student_code=student_code,
        classroom_id=current_teacher.classroom_id
    ).first()

    if not db_student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên trong lớp này.")

    if db_student.reference_image_path and os.path.exists(db_student.reference_image_path):
        os.remove(db_student.reference_image_path)

    db.delete(db_student)
    db.commit()
    return {"message": f"Sinh viên có mã {student_code} đã được xóa thành công."}

def _record_attendance_logic(student_code: str, classroom_id: int, db: Session):
    student = db.query(models.Student).filter_by(student_code=student_code, classroom_id=classroom_id).first()
    if not student:
        return None 

    system_time = datetime.utcnow() + timedelta(hours=7)
    latest_log = db.query(models.AttendanceLog)\
                     .filter(models.AttendanceLog.student_id == student.id)\
                     .order_by(models.AttendanceLog.timestamp.desc()).first()

    if latest_log and (system_time - latest_log.timestamp < timedelta(minutes=10)):
        return {
            "status": "SKIPPED", 
            "message": "Đã điểm danh gần đây, không cần ghi lại.",
            "timestamp": latest_log.timestamp
        }

    new_log = models.AttendanceLog(student_id=student.id, timestamp=system_time) 
    db.add(new_log)
    db.commit()
    db.refresh(new_log)
    return {
        "status": "RECORDED",
        "message": "Điểm danh thành công.",
        "log": new_log
    }

@app.post("/api/recognize")
def recognize_face(
    classroom_id: int = Form(...), 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    temp_dir = Path("temp")
    temp_dir.mkdir(exist_ok=True)

    # --- BẮT ĐẦU THAY ĐỔI ---
    # Tạo tên file duy nhất để tránh xung đột
    file_extension = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    temp_file_path = temp_dir / unique_filename
    # --- KẾT THÚC THAY ĐỔI ---

    with open(temp_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    specific_db_path = str(IMAGE_DB_PATH / str(classroom_id))

    if not os.path.exists(specific_db_path) or not os.listdir(specific_db_path):
        raise HTTPException(status_code=404, detail=f"Trạm điểm danh (ID: {classroom_id}) chưa có dữ liệu sinh viên.")

    try:
        dfs = DeepFace.find(
            img_path=str(temp_file_path),
            db_path=specific_db_path, 
            model_name='Facenet',
            distance_metric='cosine',
            enforce_detection=False,
            silent=True
        )
        if not dfs or dfs[0].empty:
            raise HTTPException(status_code=404, detail="Không tìm thấy khuôn mặt nào khớp trong cơ sở dữ liệu.")

        best_match = dfs[0].iloc[0]
        identity_path = Path(best_match['identity'])
        student_code = identity_path.stem.split('_')[0]
        
        student = db.query(models.Student).filter_by(student_code=student_code, classroom_id=classroom_id).first()

        if not student:
            raise HTTPException(status_code=404, detail="Sinh viên được nhận dạng nhưng không có trong CSDL của lớp.")
        
        attendance_result = _record_attendance_logic(student.student_code, student.classroom_id, db)
        
        response_data = {
            "student_name": student.name, 
            "student_code": student.student_code
        }

        if attendance_result["status"] == "RECORDED":
            response_data["status"] = "RECORDED"
            response_data["timestamp"] = attendance_result["log"].timestamp.isoformat()
        else: # SKIPPED
            response_data["status"] = "SKIPPED"
            response_data["timestamp"] = attendance_result["timestamp"].isoformat()
            
        return response_data
        
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Lỗi không xác định trong quá trình nhận dạng: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống trong quá trình nhận dạng: {str(e)}")
    finally:
        # Dọn dẹp file tạm
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

async def get_current_admin(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate admin credentials")
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role != "admin":
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    admin = db.query(models.Admin).filter(models.Admin.username == username).first()
    if admin is None:
        raise credentials_exception
    return admin

@app.post("/api/admin/analyze-attendance")
def analyze_with_gemini(request: GeminiAnalysisRequest, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    logs = (
        db.query(models.AttendanceLog)
        .join(models.Student)
        .filter(models.Student.classroom_id == request.classroom_id)
        .order_by(models.AttendanceLog.timestamp.asc())
        .all()
    )
    if not logs:
        raise HTTPException(status_code=404, detail="Không có dữ liệu điểm danh cho lớp này để phân tích.")

    data_string = "Dưới đây là dữ liệu điểm danh của một lớp học, mỗi dòng là một lượt điểm danh:\n"
    data_string += "Mã Sinh Viên, Tên Sinh Viên, Thời gian điểm danh\n"
    for log in logs:
        on_time_threshold = log.timestamp.replace(hour=8, minute=0, second=0, microsecond=0)
        status = "Đúng giờ" if log.timestamp <= on_time_threshold else "Muộn giờ"
        data_string += f"{log.student.student_code}, {log.student.name}, {log.timestamp.strftime('%Y-%m-%d %H:%M:%S')} ({status})\n"

    full_prompt = (
        "Bạn là một trợ lý phân tích dữ liệu chuyên nghiệp.\n"
        "Dựa trên dữ liệu điểm danh được cung cấp dưới đây, hãy trả lời câu hỏi sau của người dùng.\n"
        "Câu hỏi của người dùng: \"" + request.prompt + "\"\n\n"
        "Dữ liệu điểm danh:\n"
        "---------------------\n"
        f"{data_string}"
        "---------------------\n"
        "Hãy trình bày câu trả lời một cách rõ ràng, có cấu trúc, sử dụng Markdown. Nếu được yêu cầu vẽ biểu đồ, hãy tạo biểu đồ dạng văn bản (text-based chart)."
    )

    try:
        genai.configure(api_key=request.api_key)

        model = genai.GenerativeModel('gemini-1.5-flash-latest')

        response = model.generate_content(full_prompt)

        return {"analysis": response.text}

    except Exception as e:
        print(f"Lỗi khi gọi Gemini API: {e}")
        error_message = str(e)
        if "API key not valid" in error_message:
            error_message = "API Key không hợp lệ. Vui lòng kiểm tra lại."
        
        raise HTTPException(status_code=500, detail=f"Lỗi khi kết nối đến Gemini AI: {error_message}")
    
@app.delete("/api/admin/classrooms/{classroom_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_classroom(classroom_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_classroom = db.query(models.Classroom).filter(models.Classroom.id == classroom_id).first()
    if not db_classroom:
        raise HTTPException(status_code=404, detail="Lớp học không tồn tại.")
    db.delete(db_classroom)
    db.commit()
    return

@app.delete("/api/admin/teachers/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_teacher(teacher_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not db_teacher:
        raise HTTPException(status_code=404, detail="Giáo viên không tồn tại.")
    db.delete(db_teacher)
    db.commit()
    return

def generate_attendance_summary(classroom_id: int, db: Session) -> List[dict]:
    schedules = db.query(models.Schedule).filter(models.Schedule.classroom_id == classroom_id).all()
    total_scheduled_sessions = len(schedules)
    
    if total_scheduled_sessions == 0:
        return []

    students = db.query(models.Student).filter(models.Student.classroom_id == classroom_id).all()
    
    summary_list = []
    for student in students:
        on_time_count = 0
        late_count = 0
        logs_by_date = {log.timestamp.date(): log.timestamp for log in student.attendance_logs}

        for schedule in schedules:
            log_timestamp = logs_by_date.get(schedule.class_date)
            if log_timestamp:
                on_time_threshold = log_timestamp.replace(hour=8, minute=5, second=0)
                if log_timestamp <= on_time_threshold:
                    on_time_count += 1
                else:
                    late_count += 1
        
        present_count = on_time_count + late_count
        absent_count = total_scheduled_sessions - present_count

        present_rate = (present_count / total_scheduled_sessions) * 100
        on_time_rate = (on_time_count / total_scheduled_sessions) * 100
        late_rate = (late_count / total_scheduled_sessions) * 100
        absent_rate = (absent_count / total_scheduled_sessions) * 100

        summary_list.append({
            "student_id": student.id,
            "student_code": student.student_code,
            "student_name": student.name,
            "on_time_count": on_time_count,
            "late_count": late_count,
            "absent_count": absent_count,
            "present_rate": round(present_rate, 2),
            "on_time_rate": round(on_time_rate, 2),
            "late_rate": round(late_rate, 2),
            "absent_rate": round(absent_rate, 2),
            "total_scheduled_sessions": total_scheduled_sessions
        })
        
    return summary_list

@app.get("/api/teacher/attendance-summary", response_model=List[AttendanceSummaryResponse]) 
def get_teacher_attendance_summary(teacher: models.Teacher = Depends(get_current_teacher), db: Session = Depends(get_db)):
    if not teacher.classroom_id:
        return []
    return generate_attendance_summary(teacher.classroom_id, db)

@app.get("/api/admin/student-attendance-details/{student_id}", response_model=StudentDetailsResponse)
def get_student_attendance_details(student_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên.")
        
    daily_logs = generate_daily_status_logs(student, db)
    return {"student_info": student, "daily_logs": daily_logs}

@app.get("/api/teacher/student-attendance-details/{student_id}", response_model=StudentDetailsResponse)
def get_teacher_student_details(student_id: int, teacher: models.Teacher = Depends(get_current_teacher), db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.id == student_id, models.Student.classroom_id == teacher.classroom_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên hoặc sinh viên không thuộc lớp của bạn.")
    
    daily_logs = generate_daily_status_logs(student, db)
    return {"student_info": student, "daily_logs": daily_logs}

@app.get("/api/admin/classrooms/{classroom_id}/students", response_model=List[StudentResponse])
def get_students_in_classroom_for_admin(classroom_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    students = db.query(models.Student).filter(models.Student.classroom_id == classroom_id).all()
    return students

@app.put("/api/admin/students/{student_id}", response_model=StudentResponse)
def update_student_info_for_admin(student_id: int, student_update: StudentUpdateRequest, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên.")
    
    existing_student = db.query(models.Student).filter(
        models.Student.student_code == student_update.student_code,
        models.Student.classroom_id == db_student.classroom_id,
        models.Student.id != student_id
    ).first()
    if existing_student:
        raise HTTPException(status_code=400, detail="Mã sinh viên mới đã tồn tại trong lớp này.")

    db_student.name = student_update.name
    db_student.student_code = student_update.student_code
    db.commit()
    db.refresh(db_student)
    return db_student

@app.delete("/api/admin/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student_for_admin(student_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Không tìm thấy sinh viên.")

    if db_student.reference_image_path and os.path.exists(db_student.reference_image_path):
        try:
            os.remove(db_student.reference_image_path)
        except OSError as e:
            print(f"Lỗi khi xóa file ảnh: {e}") 

    db.delete(db_student)
    db.commit()
    return

@app.get("/api/admin/classrooms", response_model=List[ClassroomResponse])
def get_all_classrooms_for_admin(db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    """
    [Admin Only] Lấy danh sách tất cả các lớp học trong hệ thống.
    """
    classrooms = db.query(models.Classroom).order_by(models.Classroom.id).all()
    return classrooms

@app.get("/api/admin/teachers", response_model=List[TeacherResponse])
def get_all_teachers_for_admin(db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    """
    [Admin Only] Lấy danh sách tất cả các giáo viên trong hệ thống.
    """
    teachers = db.query(models.Teacher).order_by(models.Teacher.id).all()
    return teachers

@app.get("/api/admin/attendance-summary/{classroom_id}", response_model=List[AttendanceSummaryResponse])
def get_admin_attendance_summary(
    classroom_id: int,
    db: Session = Depends(get_db),
    admin: models.Admin = Depends(get_current_admin)
):

    summary = generate_attendance_summary(classroom_id, db)
    if not summary:
        return []
    return summary

@app.post("/api/admin/confirm-password")
def confirm_admin_password(request: PasswordConfirmationRequest, admin: models.Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    if not security.verify_password(request.password, admin.hashed_password):
        raise HTTPException(status_code=403, detail="Mật khẩu xác nhận không chính xác.")
    return {"message": "Password confirmed successfully."}


@app.post("/api/admin/schedules", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule_for_classroom(schedule: ScheduleCreate, classroom_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_schedule = models.Schedule(class_date=schedule.class_date, classroom_id=classroom_id)
    try:
        db.add(db_schedule)
        db.commit()
        db.refresh(db_schedule)
        return db_schedule
    except Exception: 
        db.rollback()
        raise HTTPException(status_code=400, detail="Ngày học này đã tồn tại cho lớp.")

@app.get("/api/admin/schedules/{classroom_id}", response_model=List[ScheduleResponse])
def get_schedules_for_classroom(classroom_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    schedules = db.query(models.Schedule).filter(models.Schedule.classroom_id == classroom_id).order_by(models.Schedule.class_date.desc()).all()
    return schedules

@app.delete("/api/admin/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db), admin: models.Admin = Depends(get_current_admin)):
    db_schedule = db.query(models.Schedule).filter(models.Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Không tìm thấy lịch học.")
    db.delete(db_schedule)
    db.commit()
    return

@app.get("/api/admin/attendance-grid/{classroom_id}", response_model=AttendanceGridResponse)
def get_attendance_grid_data(
    classroom_id: int,
    db: Session = Depends(get_db),
    admin: models.Admin = Depends(get_current_admin)
):

    schedules = db.query(models.Schedule).filter(models.Schedule.classroom_id == classroom_id).order_by(models.Schedule.class_date.desc()).all()
    scheduled_dates = [s.class_date for s in schedules]

    students = db.query(models.Student).filter(models.Student.classroom_id == classroom_id).order_by(models.Student.name).all()

    attendance_data = []
    for student in students:
        logs = {log.timestamp.date(): log for log in student.attendance_logs}
        
        student_grid_data = {
            "student_id": student.id,
            "student_name": student.name,
            "student_code": student.student_code,
            "logs_by_date": {}
        }
        
        for s_date in scheduled_dates:
            log = logs.get(s_date)
            if log:
                on_time_threshold = log.timestamp.replace(hour=8, minute=5, second=0)
                status = "PRESENT" if log.timestamp <= on_time_threshold else "LATE"
                student_grid_data["logs_by_date"][s_date] = {
                    "status": status,
                    "note": log.note,
                    "check_in_time": log.timestamp.strftime('%H:%M:%S')
                }
            else:
                student_grid_data["logs_by_date"][s_date] = {"status": "ABSENT", "note": None, "check_in_time": None}
        
        attendance_data.append(student_grid_data)

    return {"scheduled_dates": scheduled_dates, "attendance_data": attendance_data}


@app.post("/api/attendance-note", status_code=status.HTTP_200_OK)
def update_attendance_note(
    request: NoteUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_active_user)
):
    log = db.query(models.AttendanceLog).join(models.Student).filter(
        models.Student.id == request.student_id,
        db.func.date(models.AttendanceLog.timestamp) == request.class_date
    ).first()

    if log:
        log.note = request.note
    else:
        new_log = models.AttendanceLog(
            student_id=request.student_id,
            timestamp=datetime.combine(request.class_date, datetime.min.time()),
            note=request.note
        )
        db.add(new_log)

    db.commit()
    return {"message": "Ghi chú đã được cập nhật thành công."}

@app.get("/api/teacher/my-classroom", response_model=ClassroomResponse)
def get_teacher_classroom(
    current_teacher: models.Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    if not current_teacher.classroom:
        raise HTTPException(status_code=404, detail="Giáo viên này không được gán vào lớp học nào.")
    return current_teacher.classroom

@app.get("/api/teacher/attendance-grid", response_model=AttendanceGridResponse)
def get_teacher_attendance_grid(
    teacher: models.Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db)
):
    if not teacher.classroom_id:
        raise HTTPException(status_code=404, detail="Giáo viên này không phụ trách lớp nào.")
    
    return get_attendance_grid_data_logic(teacher.classroom_id, db)


@app.get("/api/admin/attendance-grid/{classroom_id}", response_model=AttendanceGridResponse)
def get_attendance_grid_data(
    classroom_id: int,
    db: Session = Depends(get_db),
    admin: models.Admin = Depends(get_current_admin)
):
    return get_attendance_grid_data_logic(classroom_id, db)

def get_attendance_grid_data_logic(classroom_id: int, db: Session):
    schedules = db.query(models.Schedule).filter(models.Schedule.classroom_id == classroom_id).order_by(models.Schedule.class_date.desc()).all()
    scheduled_dates = [s.class_date for s in schedules]

    students = db.query(models.Student).filter(models.Student.classroom_id == classroom_id).order_by(models.Student.name).all()

    attendance_data = []
    for student in students:
        logs = {log.timestamp.date(): log for log in student.attendance_logs}
        
        student_grid_data = {
            "student_id": student.id,
            "student_name": student.name,
            "student_code": student.student_code,
            "logs_by_date": {}
        }
        
        for s_date in scheduled_dates:
            log = logs.get(s_date)
            if log:
                on_time_threshold = log.timestamp.replace(hour=8, minute=5, second=0)
                status = "PRESENT" if log.timestamp <= on_time_threshold else "LATE"
                student_grid_data["logs_by_date"][s_date] = {
                    "status": status,
                    "note": log.note,
                    "check_in_time": log.timestamp.strftime('%H:%M:%S')
                }
            else:
                student_grid_data["logs_by_date"][s_date] = {"status": "ABSENT", "note": None, "check_in_time": None}
        
        attendance_data.append(student_grid_data)

    return {"scheduled_dates": scheduled_dates, "attendance_data": attendance_data}

@app.post("/api/admin/classrooms", response_model=ClassroomResponse, status_code=status.HTTP_201_CREATED)
def create_classroom_for_admin(
    classroom_data: AdminClassroomCreate,
    db: Session = Depends(get_db),
    admin: models.Admin = Depends(get_current_admin)
):
    """
    [Admin Only] Tạo một lớp học mới từ dữ liệu JSON.
    """
    existing_classroom = db.query(models.Classroom).filter(models.Classroom.name == classroom_data.name).first()
    if existing_classroom:
        raise HTTPException(status_code=400, detail=f"Tên lớp '{classroom_data.name}' đã tồn tại.")

    new_classroom = models.Classroom(name=classroom_data.name)
    db.add(new_classroom)
    db.commit()
    db.refresh(new_classroom)
    return new_classroom

@app.post("/api/admin/teachers", response_model=TeacherResponse, status_code=status.HTTP_201_CREATED)
def create_teacher_for_admin(
    teacher_data: AdminTeacherCreate,
    db: Session = Depends(get_db),
    admin: models.Admin = Depends(get_current_admin)
):
    """
    [Admin Only] Tạo một giáo viên mới.
    """
    existing_teacher = db.query(models.Teacher).filter(models.Teacher.username == teacher_data.username).first()
    if existing_teacher:
        raise HTTPException(status_code=400, detail="Tên đăng nhập của giáo viên đã tồn tại.")

    hashed_password = security.hash_password(teacher_data.password)
    new_teacher = models.Teacher(
        username=teacher_data.username,
        hashed_password=hashed_password,
        classroom_id=teacher_data.classroom_id
    )
    db.add(new_teacher)
    db.commit()
    db.refresh(new_teacher)
    return new_teacher