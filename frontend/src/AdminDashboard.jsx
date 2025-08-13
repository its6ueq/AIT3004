import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import "./Dashboard.css";

const getToken = () => localStorage.getItem("admin_token");

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
  "Content-Type": "application/json",
});

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

function AdminDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("reporting");

  const [classrooms, setClassrooms] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [newClassName, setNewClassName] = useState("");
  const [newTeacherUsername, setNewTeacherUsername] = useState("");
  const [newTeacherPassword, setNewTeacherPassword] = useState("");
  const [assignClassroomId, setAssignClassroomId] = useState("");

  const [schedules, setSchedules] = useState([]);
  const [newScheduleDate, setNewScheduleDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [scheduleClassId, setScheduleClassId] = useState("");

  const [managementSelectedClass, setManagementSelectedClass] = useState("");
  const [studentsInClass, setStudentsInClass] = useState([]);
  const [editingStudent, setEditingStudent] = useState(null);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordToConfirm, setPasswordToConfirm] = useState("");
  const [actionToConfirm, setActionToConfirm] = useState(null);

  const [selectedClassroom, setSelectedClassroom] = useState("");
  const [summaryData, setSummaryData] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentDetails, setStudentDetails] = useState(null);

  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [prompt, setPrompt] = useState(
    "Dựa vào bảng tóm tắt chuyên cần, hãy đưa ra nhận xét về tình hình đi học của lớp và chỉ ra 3 sinh viên cần được tuyên dương vì đi học đúng giờ nhiều nhất."
  );
  const [analysisResult, setAnalysisResult] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [gridData, setGridData] = useState(null);
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);

  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [currentNoteCell, setCurrentNoteCell] = useState(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user"));
    if (user) {
      setCurrentUser(user);
    }

    fetchInitialData();
  }, []);

  useEffect(() => {
    if (managementSelectedClass) {
      fetchStudentsInClass();
    }
  }, [managementSelectedClass]);

  useEffect(() => {
    if (scheduleClassId) {
      fetchSchedules(scheduleClassId);
    }
  }, [scheduleClassId]);

  useEffect(() => {
    const fetchAllDataForClass = async () => {
      if (selectedClassroom) {
        setIsLoading(true);
        setIsLoadingGrid(true);
        setMessage("");
        try {
          const [summaryRes, gridRes] = await Promise.all([
            fetch(`/api/admin/attendance-summary/${selectedClassroom}`, {
              headers: getAuthHeaders(),
            }),
            fetch(`/api/admin/attendance-grid/${selectedClassroom}`, {
              headers: getAuthHeaders(),
            }),
          ]);
          if (!summaryRes.ok) throw new Error("Lỗi tải dữ liệu tóm tắt");
          if (!gridRes.ok) throw new Error("Lỗi tải dữ liệu chi tiết cho bảng");
          setSummaryData(await summaryRes.json());
          setGridData(await gridRes.json());
        } catch (err) {
          setMessage(err.message);
          setGridData(null);
        } finally {
          setIsLoading(false);
          setIsLoadingGrid(false);
        }
      }
    };
    fetchAllDataForClass();
  }, [selectedClassroom]);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const classroomsRes = await fetch("/api/admin/classrooms", {
        headers: getAuthHeaders(),
      });
      if (!classroomsRes.ok) throw new Error("Could not fetch classrooms");
      setClassrooms(await classroomsRes.json());

      const teachersRes = await fetch("/api/admin/teachers", {
        headers: getAuthHeaders(),
      });
      if (teachersRes.ok) {
        setTeachers(await teachersRes.json());
      }
    } catch (err) {
      console.error("Fetch initial data error:", err);
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStudentsInClass = async () => {
    if (!managementSelectedClass) return;
    try {
      const res = await fetch(
        `/api/admin/classrooms/${managementSelectedClass}/students`,
        { headers: getAuthHeaders() }
      );
      if (res.ok) {
        setStudentsInClass(await res.json());
      }
    } catch (err) {
      setMessage("Lỗi: Không thể tải danh sách sinh viên.");
    }
  };

  const fetchSchedules = useCallback(async (classId) => {
    if (!classId) return setSchedules([]);
    try {
      const res = await fetch(`/api/admin/schedules/${classId}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) setSchedules(await res.json());
    } catch (err) {
      setMessage("Lỗi: Không thể tải lịch học.");
    }
  }, []);

  const fetchStudentDetails = async (studentId) => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/admin/student-attendance-details/${studentId}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error("Failed to fetch student details");
      setStudentDetails(await res.json());
    } catch (err) {
      console.error("Fetch student details error:", err);
      setMessage("Lỗi: Không thể tải chi tiết sinh viên.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (url, body, successMsg) => {
    setMessage("");
    setIsLoading(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Thao tác thất bại");
      setMessage(successMsg);
      fetchInitialData();
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (type, id) => {
    setActionToConfirm(() => () => performDelete(type, id));
    setShowPasswordModal(true);
  };

  const handlePasswordConfirmation = async (e) => {
    e.preventDefault();
    if (!actionToConfirm) return;

    setIsLoading(true);
    setMessage("");
    try {
      const confirmRes = await fetch("/api/admin/confirm-password", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ password: passwordToConfirm }),
      });
      if (!confirmRes.ok) {
        const errorData = await confirmRes.json();
        throw new Error(errorData.detail || "Mật khẩu không đúng.");
      }

      await actionToConfirm();
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setShowPasswordModal(false);
      setPasswordToConfirm("");
      setActionToConfirm(null);
      setIsLoading(false);
    }
  };

  const performDelete = async (type, id) => {
    try {
      const res = await fetch(`/api/admin/${type}s/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.status === 401) return navigate("/");
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({ detail: "Xóa thất bại" }));
        throw new Error(data.detail);
      }
      setMessage(`Đã xóa ${type} ID ${id} thành công.`);
      fetchInitialData();
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
      throw err;
    }
  };

  const handleCreateSchedule = async (e) => {
    e.preventDefault();
    await handleCreate(
      `/api/admin/schedules?classroom_id=${scheduleClassId}`,
      { class_date: newScheduleDate },
      "Thêm lịch học thành công!"
    );
    fetchSchedules(scheduleClassId);
  };

  const handleDeleteSchedule = async (scheduleId) => {
    await handleDelete("schedule", scheduleId);
    fetchSchedules(scheduleClassId);
  };

  const handleUpdateStudent = async (e) => {
    e.preventDefault();
    if (!editingStudent) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/students/${editingStudent.id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: editingStudent.name,
          student_code: editingStudent.student_code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Cập nhật thất bại.");
      setMessage("Cập nhật sinh viên thành công!");
      setEditingStudent(null);
      fetchStudentsInClass();
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteStudent = async (studentId) => {
    if (!window.confirm("Bạn có chắc muốn xóa sinh viên này?")) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Xóa thất bại.");
      setMessage("Xóa sinh viên thành công!");
      fetchStudentsInClass();
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

      const gridRes = await fetch(
        `/api/admin/attendance-grid/${selectedClassroom}`,
        { headers: getAuthHeaders() }
      );
      setGridData(await gridRes.json());
    } catch (err) {
      setMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsNoteModalOpen(false);
    }
  };

  const handleAnalyze = async () => {
    if (!geminiApiKey || !prompt || !selectedClassroom)
      return setMessage("Vui lòng nhập API Key, chọn lớp và nhập câu hỏi.");
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
          classroom_id: parseInt(selectedClassroom),
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
    localStorage.removeItem("admin_token");
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
        onTimeRate: 0,
        lateRate: 0,
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
      totalPresent > 0 ? ((totalOnTime / totalPresent) * 100).toFixed(1) : 0;
    const lateRate =
      totalPresent > 0 ? ((totalLate / totalPresent) * 100).toFixed(1) : 0;

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
              <span className="title-icon">📊</span>
              Bảng Điều Khiển Admin
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              {currentUser && (
                <span style={{ color: "#98a0a6" }}>
                  Chào, {currentUser.username}
                </span>
              )}
              <button onClick={handleLogout} className="logout-btn">
                <span className="logout-icon">🚪</span>
                Đăng xuất
              </button>
            </div>
          </div>
        </div>

        <div className="tab-navigation">
          <button
            onClick={() => setActiveTab("reporting")}
            className={`tab-btn ${activeTab === "reporting" ? "active" : ""}`}
          >
            <span className="tab-icon">📈</span>
            Báo cáo & Phân tích
          </button>
          <button
            onClick={() => setActiveTab("management")}
            className={`tab-btn ${activeTab === "management" ? "active" : ""}`}
          >
            <span className="tab-icon">⚙️</span>
            Quản lý Hệ thống
          </button>
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
          {activeTab === "reporting" && (
            <div className="reporting-section">
              <h3 className="section-title">Chọn Lớp Học</h3>
              <select
                className="modern-select"
                value={selectedClassroom}
                onChange={(e) => setSelectedClassroom(e.target.value)}
              >
                <option value="">-- Chọn lớp để xem báo cáo --</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {selectedClassroom && (
                <>
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
                        <div className="stat-percentage">
                          {stats.onTimeRate}%
                        </div>
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
                        <div className="spinner"></div>
                        <span>Đang tải dữ liệu...</span>
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
                        <span>Đang tải dữ liệu bảng...</span>
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
                                          handleCellClick(
                                            student,
                                            date,
                                            cellData
                                          )
                                        }
                                      >
                                        {cellData?.note && (
                                          <span className="note-indicator">
                                            📝
                                          </span>
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
                              <div className="color-box status-present"></div>{" "}
                              Đi học
                            </span>
                            <span className="legend-item">
                              <div className="color-box status-late"></div> Đi
                              muộn
                            </span>
                            <span className="legend-item">
                              <div className="color-box status-absent"></div>{" "}
                              Vắng
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

                  <div className="section-card">
                    <h3 className="section-title">
                      <span className="title-icon">🤖</span>
                      Phân tích bằng AI (Gemini)
                    </h3>
                    <div className="ai-analysis-form">
                      <div className="form-group">
                        <label>API Key Gemini:</label>
                        <input
                          type="password"
                          className="modern-input"
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="Nhập API Key Gemini..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Câu hỏi phân tích:</label>
                        <textarea
                          className="modern-textarea"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          rows="4"
                          placeholder="Nhập câu hỏi hoặc yêu cầu phân tích..."
                        />
                      </div>
                      <button
                        onClick={handleAnalyze}
                        disabled={isLoading}
                        className="btn-primary"
                      >
                        {isLoading ? (
                          <>
                            <div className="btn-spinner"></div>
                            Đang phân tích...
                          </>
                        ) : (
                          <>
                            <span className="btn-icon">🔍</span>
                            Gửi Phân Tích
                          </>
                        )}
                      </button>
                    </div>
                    {analysisResult && (
                      <div className="ai-result">
                        <h4>Kết quả phân tích:</h4>
                        <div className="markdown-content">
                          <ReactMarkdown>{analysisResult}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "management" && (
            <div className="management-section">
              <div className="section-card">
                <h3 className="section-title">
                  <span className="title-icon">➕</span>
                  Tạo Mới
                </h3>

                <div className="create-form">
                  <h4>Tạo Lớp Học Mới</h4>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreate(
                        "/api/admin/classrooms",
                        { name: newClassName },
                        "Tạo lớp thành công!"
                      );
                      setNewClassName("");
                    }}
                  >
                    <div className="form-row">
                      <input
                        type="text"
                        className="modern-input"
                        value={newClassName}
                        onChange={(e) => setNewClassName(e.target.value)}
                        placeholder="Tên lớp/trạm mới"
                        required
                      />
                      <button type="submit" className="btn-primary">
                        <span className="btn-icon">🏫</span>
                        Tạo Lớp
                      </button>
                    </div>
                  </form>
                </div>

                <div className="divider"></div>

                <div className="create-form">
                  <h4>Tạo Giáo Viên Mới</h4>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreate(
                        "/api/admin/teachers",
                        {
                          username: newTeacherUsername,
                          password: newTeacherPassword,
                          classroom_id: parseInt(assignClassroomId),
                        },
                        "Tạo giáo viên thành công!"
                      );
                      setNewTeacherUsername("");
                      setNewTeacherPassword("");
                      setAssignClassroomId("");
                    }}
                  >
                    <div className="form-row">
                      <input
                        type="text"
                        className="modern-input"
                        value={newTeacherUsername}
                        onChange={(e) => setNewTeacherUsername(e.target.value)}
                        placeholder="Tên đăng nhập"
                        required
                      />
                      <input
                        type="password"
                        className="modern-input"
                        value={newTeacherPassword}
                        onChange={(e) => setNewTeacherPassword(e.target.value)}
                        placeholder="Mật khẩu"
                        required
                      />
                    </div>
                    <div className="form-row">
                      <select
                        className="modern-select"
                        value={assignClassroomId}
                        onChange={(e) => setAssignClassroomId(e.target.value)}
                        required
                      >
                        <option value="">-- Gán giáo viên vào lớp --</option>
                        {classrooms.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-primary">
                        <span className="btn-icon">👨‍🏫</span>
                        Tạo Giáo Viên
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              <div className="management-grid">
                <div className="section-card">
                  <h3 className="section-title">
                    <span className="title-icon">🏫</span>
                    Danh Sách Lớp Học
                  </h3>
                  <div className="table-container">
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tên Lớp</th>
                          <th>Hành Động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {classrooms.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <span className="badge badge-id">{c.id}</span>
                            </td>
                            <td>
                              <span className="classroom-name">{c.name}</span>
                            </td>
                            <td>
                              <button
                                className="btn-danger small"
                                onClick={() => handleDelete("classroom", c.id)}
                              >
                                🗑️ Xóa
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="section-card">
                  <h3 className="section-title">
                    <span className="title-icon">👨‍🏫</span>
                    Danh Sách Giáo Viên
                  </h3>
                  <div className="table-container">
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tên Đăng Nhập</th>
                          <th>Lớp</th>
                          <th>Hành Động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teachers.map((t) => {
                          const classroom = classrooms.find(
                            (c) => c.id === t.classroom_id
                          );
                          return (
                            <tr key={t.id}>
                              <td>
                                <span className="badge badge-id">{t.id}</span>
                              </td>
                              <td>
                                <span className="teacher-username">
                                  {t.username}
                                </span>
                              </td>
                              <td>
                                <span className="classroom-badge">
                                  {classroom
                                    ? classroom.name
                                    : `ID: ${t.classroom_id}`}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="btn-danger small"
                                  onClick={() => handleDelete("teacher", t.id)}
                                >
                                  🗑️ Xóa
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="section-card">
                <h3 className="section-title">
                  <span className="title-icon">🗓️</span>
                  Quản Lý Lịch Học
                </h3>
                <div className="create-form">
                  <h4>Thêm Buổi Học Mới</h4>
                  <form onSubmit={handleCreateSchedule}>
                    <div className="form-row">
                      <select
                        className="modern-select"
                        value={scheduleClassId}
                        onChange={(e) => setScheduleClassId(e.target.value)}
                        required
                      >
                        <option value="">-- Chọn lớp --</option>
                        {classrooms.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        className="modern-input"
                        value={newScheduleDate}
                        onChange={(e) => setNewScheduleDate(e.target.value)}
                        required
                      />
                      <button type="submit" className="btn-primary">
                        Thêm Lịch
                      </button>
                    </div>
                  </form>
                </div>
                {scheduleClassId && (
                  <div
                    className="table-container"
                    style={{ marginTop: "1.5rem" }}
                  >
                    <h4>Lịch học của lớp đã chọn:</h4>
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>Ngày học</th>
                          <th>Hành động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedules.map((s) => (
                          <tr key={s.id}>
                            <td>{formatDate(s.class_date)}</td>
                            <td>
                              <button
                                className="btn-danger small"
                                onClick={() => handleDeleteSchedule(s.id)}
                              >
                                🗑️ Xóa
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
                  <span className="title-icon">🎓</span>
                  Quản Lý Sinh Viên
                </h3>
                <div className="form-group">
                  <label>Chọn Lớp để Quản lý Sinh viên:</label>
                  <select
                    className="modern-select"
                    value={managementSelectedClass}
                    onChange={(e) => setManagementSelectedClass(e.target.value)}
                  >
                    <option value="">-- Chọn lớp --</option>
                    {classrooms.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {managementSelectedClass && (
                  <div className="table-container">
                    <table className="modern-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Mã SV</th>
                          <th>Họ Tên</th>
                          <th>Hành Động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentsInClass.map((student) => (
                          <tr key={student.id}>
                            <td>
                              <span className="badge badge-id">
                                {student.id}
                              </span>
                            </td>
                            <td>
                              <span className="student-code">
                                {student.student_code}
                              </span>
                            </td>
                            <td>
                              <span className="student-name">
                                {student.name}
                              </span>
                            </td>
                            <td style={{ display: "flex", gap: "0.5rem" }}>
                              <button
                                className="btn-detail"
                                onClick={() => setEditingStudent(student)}
                              >
                                Sửa
                              </button>
                              <button
                                className="btn-danger small"
                                onClick={() => handleDeleteStudent(student.id)}
                              >
                                🗑️ Xóa
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
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
              {isLoading && <p>Đang tải chi tiết...</p>}
              {studentDetails && (
                <>
                  <div className="student-info"></div>
                  <div className="attendance-details">
                    <h4>Lịch trình 10 ngày học gần nhất:</h4>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editingStudent && (
        <div className="modal-overlay" onClick={() => setEditingStudent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Chỉnh sửa thông tin sinh viên</h3>
              <button
                className="modal-close"
                onClick={() => setEditingStudent(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleUpdateStudent} className="create-form">
                <div className="form-group">
                  <label>Họ và Tên:</label>
                  <input
                    type="text"
                    className="modern-input"
                    value={editingStudent.name}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        name: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Mã Sinh Viên:</label>
                  <input
                    type="text"
                    className="modern-input"
                    value={editingStudent.student_code}
                    onChange={(e) =>
                      setEditingStudent({
                        ...editingStudent,
                        student_code: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isLoading}
                >
                  {isLoading ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "400px" }}>
            <div className="modal-header">
              <h3>Xác nhận mật khẩu Admin</h3>
              <button
                className="modal-close"
                onClick={() => setShowPasswordModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Để thực hiện hành động này, vui lòng nhập lại mật khẩu của bạn.
              </p>
              <form onSubmit={handlePasswordConfirmation}>
                <div className="form-group">
                  <input
                    type="password"
                    className="modern-input"
                    value={passwordToConfirm}
                    onChange={(e) => setPasswordToConfirm(e.target.value)}
                    placeholder="Nhập mật khẩu..."
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="btn-danger"
                  disabled={isLoading}
                >
                  {isLoading ? "Đang xác nhận..." : "Xác nhận và Xóa"}
                </button>
              </form>
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
                <small>
                  Ngày:{" "}
                  {new Date(currentNoteCell.date).toLocaleDateString("vi-VN")}
                </small>
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
                placeholder="Nhập ghi chú (ví dụ: xin phép, đi muộn vì...)"
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

export default AdminDashboard;
