from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Date 
from sqlalchemy.orm import relationship
from database import Base
import datetime

class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

class Classroom(Base):
    __tablename__ = "classrooms"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    
    teacher = relationship("Teacher", back_populates="classroom", uselist=False, cascade="all, delete-orphan")
    students = relationship("Student", back_populates="classroom", cascade="all, delete-orphan")

class Teacher(Base):
    __tablename__ = "teachers"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    current_session_id = Column(String, nullable=True) 
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), unique=True, nullable=False)
    classroom = relationship("Classroom", back_populates="teacher")

class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True, index=True)
    student_code = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    reference_image_path = Column(String)
    
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), nullable=False)
    classroom = relationship("Classroom", back_populates="students")
    
    attendance_logs = relationship("AttendanceLog", back_populates="student", cascade="all, delete-orphan")
    
    __table_args__ = (UniqueConstraint('student_code', 'classroom_id', name='_student_classroom_uc'),)


class AttendanceLog(Base):
    __tablename__ = "attendance_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.now)
    status = Column(String, default="PRESENT") 
    note = Column(String, nullable=True)
    
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    student = relationship("Student", back_populates="attendance_logs")
    
class Schedule(Base):
    __tablename__ = "schedules"
    id = Column(Integer, primary_key=True, index=True)
    class_date = Column(Date, nullable=False)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), nullable=False)
    
    __table_args__ = (UniqueConstraint('class_date', 'classroom_id', name='_class_date_classroom_uc'),)
    
def get_vietnam_time_naive():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=7)