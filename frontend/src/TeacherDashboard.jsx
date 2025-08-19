import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import "./Dashboard.css";

const getToken = () => localStorage.getItem("teacher_token");

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  "Content-Type": "application/json",
});

const formatDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

function TeacherDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);

  const [teacherClassroom, setTeacherClassroom] = useState(null);
  const [summaryData, setSummaryData] = useState([]);
  const [gridData, setGridData] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingGrid, setIsLoadingGrid] = useState(true);
  const [message, setMessage] = useState("");

  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [currentNoteCell, setCurrentNoteCell] = useState(null);
  const [noteText, setNoteText] = useState("");

  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [prompt, setPrompt] = useState(
    "Dựa vào dữ liệu chuyên cần, hãy đưa ra nhận xét về tình hình đi học của lớp."
  );
  const [analysisResult, setAnalysisResult] = useState("");

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user"));
    if (user) setCurrentUser(user);

    const savedApiKey = localStorage.getItem("gemini_api_key");
    if (savedApiKey) setGeminiApiKey(savedApiKey);

    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    const headers = getAuthHeaders();
    try {
      const [summaryRes, classroomRes, gridRes] = await Promise.all([
        fetch("/api/teacher/attendance-summary", { headers }),
        fetch("/api/teacher/my-classroom", { headers }),
        fetch("/api/teacher/attendance-grid", { headers }),
      ]);

      if (!summaryRes.ok || !classroomRes.ok || !gridRes.ok) {
        throw new Error("Không thể tải dữ liệu của giáo viên.");
      }

      setSummaryData(await summaryRes.json());
      setTeacherClassroom(await classroomRes.json());
      setGridData(await gridRes.json());
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsLoadingGrid(false);
    }
  };

  const fetchStudentDetails = async (studentId) => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/teacher/student-attendance-details/${studentId}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error("Không thể tải chi tiết sinh viên.");
      setStudentDetails(await res.json());
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCellClick = (student, date, cellData) => {
    setCurrentNoteCell({ student, date, cellData });
    setNoteText(cellData?.note || "");
    setIsNoteModalOpen(true);
  };

  const handleSaveNote = async () => {
    if (!currentNoteCell) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/attendance-note", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          student_id: currentNoteCell.student.student_id,
          class_date: currentNoteCell.date,
          note: noteText,
        }),
      });
      if (!res.ok) throw new Error("Lỗi khi lưu ghi chú");
      setMessage("Lưu ghi chú thành công!");
      const gridRes = await fetch("/api/teacher/attendance-grid", {
        headers: getAuthHeaders(),
      });
      if (gridRes.ok) {
        setGridData(await gridRes.json());
      }
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsNoteModalOpen(false);
    }
  };

  const handleAnalyze = async () => {
    if (!geminiApiKey || !prompt || !teacherClassroom)
      return setMessage("Vui lòng nhập API Key và câu hỏi.");
    localStorage.setItem("gemini_api_key", geminiApiKey);
    setIsLoading(true);
    setMessage("");
    setAnalysisResult("");
    try {
      const res = await fetch("/api/admin/analyze-attendance", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          api_key: geminiApiKey,
          prompt,
          classroom_id: teacherClassroom.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setAnalysisResult(data.analysis);
    } catch (err) {
      setMessage(`Lỗi phân tích: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("teacher_token");
    localStorage.removeItem("user");
    navigate("/");
  };

  const getAttendanceStats = () => {
    if (!summaryData || summaryData.length === 0) {
      return {
        totalStudents: 0,
        totalOnTime: 0,
        totalLate: 0,
        totalAbsences: 0,
        onTimeRate: "0.0",
        lateRate: "0.0",
      };
    }
    const totalStudents = summaryData.length;
    const totalOnTime = summaryData.reduce(
      (sum, s) => sum + s.on_time_count,
      0
    );
    const totalLate = summaryData.reduce((sum, s) => sum + s.late_count, 0);
    const totalAbsences = summaryData.reduce(
      (sum, s) => sum + s.absent_count,
      0
    );
    const totalPresent = totalOnTime + totalLate;
    const onTimeRate =
      totalPresent > 0
        ? ((totalOnTime / totalPresent) * 100).toFixed(1)
        : "0.0";
    const lateRate =
      totalPresent > 0 ? ((totalLate / totalPresent) * 100).toFixed(1) : "0.0";
    return {
      totalStudents,
      totalOnTime,
      totalLate,
      totalAbsences,
      onTimeRate,
      lateRate,
    };
  };

  const stats = getAttendanceStats();

  return (
    <div className="admin-dashboard">
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div className="header-content">
            <h1 className="dashboard-title">
              <span className="title-icon">📊</span>Bảng Điều Khiển Giáo Viên
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {currentUser && (
                <span style={{ color: "#98a0a6" }}>
                  Chào, {currentUser.username}
                </span>
              )}
              <button onClick={handleLogout} className="logout-btn">
                <span className="logout-icon">🚪</span>Đăng xuất
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div
            className={`alert ${
              message.includes("Lỗi") ? "alert-error" : "alert-success"
            }`}
          >
            {message}
          </div>
        )}

        <div className="dashboard-content">
          <div className="reporting-section">
            {teacherClassroom && (
              <div className="classroom-info-card">
                <span className="info-label">Lớp Phụ Trách:</span>
                <span className="info-value">{teacherClassroom.name}</span>
              </div>
            )}

            <div className="stats-grid">
              <div className="stat-card primary">
                <div className="stat-icon">👥</div>
                <div className="stat-content">
                  <div className="stat-number">{stats.totalStudents}</div>
                  <div className="stat-label">Tổng số sinh viên</div>
                </div>
              </div>
              <div className="stat-card success">
                <div className="stat-icon">✅</div>
                <div className="stat-content">
                  <div className="stat-number">{stats.totalOnTime}</div>
                  <div className="stat-label">Lượt đúng giờ</div>
                  <div className="stat-percentage">{stats.onTimeRate}%</div>
                </div>
              </div>
              <div className="stat-card warning">
                <div className="stat-icon">⏰</div>
                <div className="stat-content">
                  <div className="stat-number">{stats.totalLate}</div>
                  <div className="stat-label">Lượt đi muộn</div>
                  <div className="stat-percentage">{stats.lateRate}%</div>
                </div>
              </div>
              <div className="stat-card danger">
                <div className="stat-icon">❌</div>
                <div className="stat-content">
                  <div className="stat-number">{stats.totalAbsences}</div>
                  <div className="stat-label">Tổng Lượt Vắng Mặt</div>
                </div>
              </div>
            </div>

            <div className="section-card">
              <h3 className="section-title">Bảng Tóm Tắt Chuyên Cần</h3>
              {isLoading ? (
                <div className="loading-spinner">
                  <span>Đang tải...</span>
                </div>
              ) : (
                <div className="table-container">
                  <table className="modern-table">
                    <thead>
                      <tr>
                        <th>Mã SV</th>
                        <th>Họ Tên</th>
                        <th>Tổng Lượt</th>
                        <th>Đúng Giờ</th>
                        <th>Đi Muộn</th>
                        <th>Tỷ Lệ Đúng Giờ</th>
                        <th>Chi Tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryData.map((s) => (
                        <tr key={s.student_id}>
                          <td>
                            <span className="student-code">
                              {s.student_code}
                            </span>
                          </td>
                          <td>
                            <span className="student-name">
                              {s.student_name}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-total">
                              {s.on_time_count + s.late_count} /{" "}
                              {s.total_scheduled_sessions}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-success">
                              {s.on_time_count}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-warning">
                              {s.late_count}
                            </span>
                          </td>
                          <td>
                            <div className="progress-container">
                              <div
                                className="progress-bar"
                                style={{ width: `${s.on_time_rate}%` }}
                              ></div>
                              <span className="progress-text">
                                {s.on_time_rate.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td>
                            <button
                              className="btn-detail"
                              onClick={() => {
                                setSelectedStudent(s);
                                fetchStudentDetails(s.student_id);
                              }}
                            >
                              Xem chi tiết
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="section-card">
              <h3 className="section-title">
                Bảng Chi Tiết Chuyên Cần Toàn Lớp
              </h3>
              {isLoadingGrid ? (
                <div className="loading-spinner">
                  <span>Đang tải...</span>
                </div>
              ) : (
                gridData && (
                  <div className="attendance-grid-container">
                    <table className="attendance-grid-table">
                      <thead>
                        <tr>
                          <th className="sticky-col">Họ Tên Sinh Viên</th>
                          {gridData.scheduled_dates.map((date) => (
                            <th key={date}>{formatDate(date)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {gridData.attendance_data.map((student) => (
                          <tr key={student.student_id}>
                            <td className="sticky-col student-name-cell">
                              {student.student_name}
                            </td>
                            {gridData.scheduled_dates.map((date) => {
                              const cellData = student.logs_by_date[date];
                              const cellClass = `status-${
                                cellData?.status.toLowerCase() || "absent"
                              }`;
                              return (
                                <td
                                  key={`${student.student_id}-${date}`}
                                  className={`grid-cell ${cellClass}`}
                                  onClick={() =>
                                    handleCellClick(student, date, cellData)
                                  }
                                >
                                  {cellData?.note && (
                                    <span className="note-indicator">📝</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="legend">
                      <span className="legend-item">
                        <div className="color-box status-present"></div> Đi học
                      </span>
                      <span className="legend-item">
                        <div className="color-box status-late"></div> Đi muộn
                      </span>
                      <span className="legend-item">
                        <div className="color-box status-absent"></div> Vắng
                      </span>
                      <span className="legend-item">
                        <div className="color-box status-absent_with_note"></div>{" "}
                        Vắng (có phép)
                      </span>
                      <span className="legend-item">📝 Có ghi chú</span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedStudent && (
        <div className="modal-overlay" onClick={() => setSelectedStudent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chi tiết điểm danh - {studentDetails?.student_info?.name}</h3>
              <button
                className="modal-close"
                onClick={() => setSelectedStudent(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {isLoading ? (
                <p>Đang tải chi tiết...</p>
              ) : (
                studentDetails && (
                  <div className="attendance-details">
                    <h4>Lịch trình các buổi học:</h4>
                    <div className="attendance-list">
                      {studentDetails.daily_logs?.map((log) => (
                        <div key={log.date} className="attendance-item">
                          <div className="date-time">
                            <span className="date">{formatDate(log.date)}</span>
                          </div>
                          {log.status === "PRESENT" && (
                            <span className="status-badge on-time">
                              ✅ Có mặt ({log.check_in_time})
                            </span>
                          )}
                          {log.status === "LATE" && (
                            <span className="status-badge late">
                              ⏰ Đi muộn ({log.check_in_time})
                            </span>
                          )}
                          {log.status === "ABSENT" && (
                            <span className="status-badge absent">
                              ❌ Vắng mặt
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {isNoteModalOpen && currentNoteCell && (
        <div
          className="modal-overlay"
          onClick={() => setIsNoteModalOpen(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                Ghi chú cho {currentNoteCell.student.student_name}
                <br />
                <small>Ngày: {formatDate(currentNoteCell.date)}</small>
              </h3>
              <button
                className="modal-close"
                onClick={() => setIsNoteModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="note-info">
                <strong>Trạng thái: </strong>
                {currentNoteCell.cellData?.status || "ABSENT"}
                {currentNoteCell.cellData?.check_in_time &&
                  ` (lúc ${currentNoteCell.cellData.check_in_time})`}
              </div>
              <textarea
                className="modern-textarea"
                rows="5"
                placeholder="Nhập ghi chú (vd: xin phép, đi muộn vì...)"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button
                onClick={handleSaveNote}
                disabled={isLoading}
                className="btn-primary"
              >
                {isLoading ? "Đang lưu..." : "Lưu Ghi Chú"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TeacherDashboard;
