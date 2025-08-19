import React, { useState, useRef, useCallback, useEffect } from "react";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl"; 
import * as faceDetection from "@tensorflow-models/face-detection";
import "./App.css";
import { useNavigate } from "react-router-dom";

const CLASSROOM_ID = import.meta.env.VITE_APP_CLASSROOM_ID;

function AttendanceStation() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(
    "Bắt đầu quá trình thiết lập..."
  );
  const [, forceRender] = useState(0);

  const navigate = useNavigate();

  const [initializationError, setInitializationError] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("teacher_token"));
  const [isLoggedIn, setIsLoggedIn] = useState(!!token);

  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loginError, setLoginError] = useState("");
  const [nextAction, setNextAction] = useState(null);
  const [activeOverlay, setActiveOverlay] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [classroomInfo, setClassroomInfo] = useState(null);

  const videoRef = useRef(null);
  const wrapperRef = useRef(null);

  const [name, setName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [registerStatus, setRegisterStatus] = useState("");
  const [students, setStudents] = useState([]);

  const [detectionModel, setDetectionModel] = useState(null);

  const facesRef = useRef([]);

  const recognitionStatusRef = useRef(new Set());

  useEffect(() => {
    const loadApp = async () => {
      try {
        await tf.setBackend("webgl");
        const model = await faceDetection.createDetector(
          faceDetection.SupportedModels.MediaPipeFaceDetector,
          {
            runtime: "mediapipe",
            solutionPath:
              "https://cdn.jsdelivr.net/npm/@mediapipe/face_detection",
          }
        );
        setDetectionModel(model);

        const storedToken = localStorage.getItem("teacher_token");
        if (storedToken) {
          try {
            const response = await fetch("/api/teacher/my-classroom", {
              headers: { Authorization: `Bearer ${storedToken}` },
            });

            if (!response.ok) {
              localStorage.removeItem("teacher_token");
              localStorage.removeItem("user");
              setToken(null);
              setIsLoggedIn(false);
            }
          } catch (error) {
            localStorage.removeItem("teacher_token");
            localStorage.removeItem("user");
            setToken(null);
            setIsLoggedIn(false);
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Initialization failed: ", err);
        if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          setInitializationError(
            "Không thể bật camera. Nó có thể đang được sử dụng bởi một ứng dụng hoặc tab khác. Vui lòng kiểm tra lại."
          );
        } else if (
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError"
        ) {
          setInitializationError(
            "Bạn đã chặn quyền truy cập camera. Vui lòng cho phép trong cài đặt trình duyệt để ứng dụng hoạt động."
          );
        } else {
          setInitializationError(
            `Lỗi không xác định khi khởi tạo: ${err.message}. Hãy thử tải lại trang.`
          );
        }
      }
    };
    loadApp();
  }, []);

  const closeOverlay = useCallback(() => {
    setActiveOverlay(null);
    setName("");
    setStudentCode("");
    setPreview(null);
    setFile(null);
    setRegisterStatus("");
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  }, []);

  const getAuthHeaders = useCallback(() => {
    return {
      Authorization: `Bearer ${localStorage.getItem("teacher_token")}`,
    };
  }, [token]);

  const fetchClassroomInfo = useCallback(async () => {
    try {
      const response = await fetch("/api/teacher/my-classroom", {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setClassroomInfo(data);
      }
    } catch (error) {
      console.error("Failed to fetch classroom info:", error);
    }
  }, [getAuthHeaders]);
  useEffect(() => {
    let isActive = true;
    let animationFrameId = null;

    const detectionLoop = async () => {
      if (!isActive) return;

      try {
        if (
          detectionModel &&
          videoRef.current?.readyState === 4 &&
          wrapperRef.current &&
          activeOverlay === null
        ) {
          const PIXEL_THRESHOLD = 75,
            GRACE_PERIOD = 500,
            SMOOTHING_FACTOR = 0.6;
          const getBoxCenter = (box) => ({
            x: box.xMin + box.width / 2,
            y: box.yMin + box.height / 2,
          });
          const lerp = (start, end, amt) => start + (end - start) * amt;
          const facesRaw = await detectionModel.estimateFaces(
            videoRef.current,
            {
              flipHorizontal: false,
            }
          );

          const newFaces = [];
          const matchedOldFaceIds = new Set();
          const matchedNewFaceIndices = new Set();

          facesRaw.forEach((newFace, newIndex) => {
            let bestMatch = { oldFaceId: null, distance: Infinity };
            facesRef.current.forEach((oldFace) => {
              if (matchedOldFaceIds.has(oldFace.id)) return;
              const dist = Math.hypot(
                getBoxCenter(newFace.box).x - getBoxCenter(oldFace.rawBox).x,
                getBoxCenter(newFace.box).y - getBoxCenter(oldFace.rawBox).y
              );
              if (dist < PIXEL_THRESHOLD && dist < bestMatch.distance)
                bestMatch = { oldFaceId: oldFace.id, distance: dist };
            });
            if (bestMatch.oldFaceId !== null) {
              const oldFaceData = facesRef.current.find(
                (f) => f.id === bestMatch.oldFaceId
              );
              newFaces.push({
                ...oldFaceData,
                rawBox: newFace.box,
                lastSeen: Date.now(),
                opacity: 1,
              });
              matchedOldFaceIds.add(bestMatch.oldFaceId);
              matchedNewFaceIndices.add(newIndex);
            }
          });

          facesRef.current.forEach((oldFace) => {
            if (!matchedOldFaceIds.has(oldFace.id)) {
              if (Date.now() - oldFace.lastSeen < GRACE_PERIOD)
                newFaces.push({ ...oldFace, opacity: 0 });
              else recognitionStatusRef.current.delete(oldFace.id);
            }
          });

          const video = videoRef.current;
          const scale = Math.max(
            wrapperRef.current.offsetWidth / video.videoWidth,
            wrapperRef.current.offsetHeight / video.videoHeight
          );
          const offsetX =
            (wrapperRef.current.offsetWidth - video.videoWidth * scale) / 2;
          const offsetY =
            (wrapperRef.current.offsetHeight - video.videoHeight * scale) / 2;

          facesRaw.forEach((newFace, newIndex) => {
            if (!matchedNewFaceIndices.has(newIndex)) {
              const initialDisplayBox = {
                xMin: newFace.box.xMin * scale + offsetX,
                yMin: newFace.box.yMin * scale + offsetY,
                width: newFace.box.width * scale,
                height: newFace.box.height * scale,
              };
              newFaces.push({
                id: Date.now() + Math.random(),
                rawBox: newFace.box,
                displayBox: initialDisplayBox,
                name: null,
                student_code: null,
                history: [],
                lastSeen: Date.now(),
                opacity: 1,
              });
            }
          });

          newFaces.forEach((face) => {
            const targetDisplayBox = {
              xMin: face.rawBox.xMin * scale + offsetX,
              yMin: face.rawBox.yMin * scale + offsetY,
              width: face.rawBox.width * scale,
              height: face.rawBox.height * scale,
            };
            face.displayBox = {
              xMin: lerp(
                face.displayBox.xMin,
                targetDisplayBox.xMin,
                SMOOTHING_FACTOR
              ),
              yMin: lerp(
                face.displayBox.yMin,
                targetDisplayBox.yMin,
                SMOOTHING_FACTOR
              ),
              width: lerp(
                face.displayBox.width,
                targetDisplayBox.width,
                SMOOTHING_FACTOR
              ),
              height: lerp(
                face.displayBox.height,
                targetDisplayBox.height,
                SMOOTHING_FACTOR
              ),
            };
          });

          facesRef.current = newFaces;
          forceRender((tick) => (tick + 1) & 0xffff);
        }
      } catch (error) {
        console.error("Error in detection loop:", error);
      } finally {
        animationFrameId = requestAnimationFrame(detectionLoop);
      }
    };

    detectionLoop();

    return () => {
      isActive = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [detectionModel, activeOverlay]);
  useEffect(() => {
    const recognizeFace = async (face) => {
      if (!videoRef.current || !face) return;
      recognitionStatusRef.current.add(face.id);
      const { rawBox } = face;
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = rawBox.width;
      canvas.height = rawBox.height;
      const context = canvas.getContext("2d");
      context.drawImage(
        video,
        rawBox.xMin,
        rawBox.yMin,
        rawBox.width,
        rawBox.height,
        0,
        0,
        rawBox.width,
        rawBox.height
      );
      canvas.toBlob(async (blob) => {
        if (!blob) {
          recognitionStatusRef.current.delete(face.id);
          return;
        }
        const formData = new FormData();
        formData.append("file", blob, "face.jpg");
        formData.append("classroom_id", CLASSROOM_ID);
        try {
          const response = await fetch("/api/recognize", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) return;
          const data = await response.json();
          const checkinTime = new Date(data.timestamp).toLocaleTimeString(
            "vi-VN",
            { hour: "2-digit", minute: "2-digit" }
          );
          let attendanceMessage =
            data.status === "RECORDED"
              ? `✅ Điểm danh lúc: ${checkinTime}`
              : `⏰ Đã điểm danh lúc: ${checkinTime}`;
          const faceToUpdate = facesRef.current.find((f) => f.id === face.id);
          if (faceToUpdate) {
            faceToUpdate.name = data.student_name;
            faceToUpdate.student_code = data.student_code;
            faceToUpdate.history = [attendanceMessage];
            setTimeout(() => {
              const faceToReset = facesRef.current.find(
                (f) => f.id === face.id
              );
              if (faceToReset) {
                faceToReset.name = null;
                faceToReset.student_code = null;
                faceToReset.history = [];
                recognitionStatusRef.current.delete(face.id);
              }
            }, 10000);
          }
        } catch (error) {
          console.error("Recognition API failed:", error);
          recognitionStatusRef.current.delete(face.id);
        }
      }, "image/jpeg");
    };
    const recognitionInterval = setInterval(() => {
      if (activeOverlay !== null) return;
      const faceToRecognize = facesRef.current.find(
        (f) =>
          !f.name && !recognitionStatusRef.current.has(f.id) && f.opacity > 0.5
      );
      if (faceToRecognize) {
        recognizeFace(faceToRecognize);
      }
    }, 1500);
    return () => clearInterval(recognitionInterval);
  }, [activeOverlay]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchClassroomInfo();
    }
  }, [isLoggedIn, fetchClassroomInfo]);

  const handleAdminAction = (action) => {
    if (action === "manage" && isLoggedIn) {
      navigate("/teacher-dashboard");
      return;
    }

    if (isLoggedIn) {
      setActiveOverlay(action);
      if (action === "manage") fetchStudents();
    } else {
      setNextAction(() => () => {
        if (action === "manage") {
          navigate("/teacher-dashboard");
        } else {
          setActiveOverlay(action);
        }
      });
      setShowLogin(true);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const teacherResponse = await fetch("/api/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (teacherResponse.ok) {
        const data = await teacherResponse.json();
        localStorage.setItem("teacher_token", data.access_token);
        localStorage.setItem("user", JSON.stringify(data.user));

        setToken(data.access_token);
        setIsLoggedIn(true);
        setShowLogin(false);
        setUsername("");
        setPassword("");
        if (typeof nextAction === "function") {
          nextAction();
        }
        return;
      }

      const adminResponse = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (adminResponse.ok) {
        const data = await adminResponse.json();
        localStorage.setItem("admin_token", data.access_token);
        localStorage.setItem("user", JSON.stringify(data.user));

        navigate("/admin-dashboard");
        return;
      }

      throw new Error("Tên đăng nhập hoặc mật khẩu không đúng.");
    } catch (err) {
      setLoginError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("teacher_token");
    localStorage.removeItem("user");
    setToken(null);
    setIsLoggedIn(false);
    setActiveOverlay(null);
    setClassroomInfo(null);
  };

  const fetchStudents = async () => {
    try {
      const response = await fetch("/api/students", {
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        setIsLoggedIn(false);
        setToken(null);
        localStorage.removeItem("token");
        setActiveOverlay(null);
        alert("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
        return;
      }
      if (!response.ok) throw new Error("Could not fetch students");
      const data = await response.json();
      setStudents(data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = async (studentCode) => {
    if (
      window.confirm(`Bạn có chắc chắn muốn xóa sinh viên mã ${studentCode}?`)
    ) {
      try {
        const response = await fetch(`/api/students/${studentCode}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Xóa thất bại.");
        alert(data.message);
        fetchStudents();
      } catch (err) {
        alert(`Lỗi: ${err.message}`);
      }
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !studentCode || !file) {
      setRegisterStatus("Vui lòng điền đầy đủ thông tin và chụp ảnh.");
      return;
    }
    const formData = new FormData();
    formData.append("name", name);
    formData.append("student_code", studentCode);
    formData.append("file", file, `${studentCode}_register.jpg`);
    setRegisterStatus("Đang đăng ký...");
    try {
      const response = await fetch("/api/students", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Đăng ký thất bại.");
      setRegisterStatus(`Đăng ký thành công: ${data.name}`);
      setName("");
      setStudentCode("");
      setFile(null);
      setPreview(null);
    } catch (err) {
      setRegisterStatus(`Lỗi: ${err.message}`);
    }
  };

  const handleCaptureForRegister = async () => {
    if (!videoRef.current || !detectionModel) {
      alert("Model chưa sẵn sàng, vui lòng đợi một lát.");
      return;
    }

    const video = videoRef.current;

    const faces = await detectionModel.estimateFaces(video, {
      flipHorizontal: false,
    });

    if (!faces || faces.length === 0) {
      alert("Không tìm thấy khuôn mặt. Vui lòng căn chỉnh lại!");
      return;
    }
    const face = faces[0];
    const rawBox = face.box;

    const canvas = document.createElement("canvas");
    canvas.width = rawBox.width;
    canvas.height = rawBox.height;
    const context = canvas.getContext("2d");

    context.drawImage(
      video,
      rawBox.xMin,
      rawBox.yMin,
      rawBox.width,
      rawBox.height,
      0,
      0,
      rawBox.width,
      rawBox.height
    );

    setPreview(canvas.toDataURL("image/jpeg"));
    canvas.toBlob((blob) => setFile(blob), "image/jpeg");
  };

  const renderBoundingBoxes = () => {
    const faces = facesRef.current;
    return faces.map((face) => {
      const { displayBox, opacity, name, history, id } = face;

      const boxStyle = {
        transform: `translate3d(${displayBox?.xMin ?? 0}px, ${
          displayBox?.yMin ?? 0
        }px, 0)`,
        width: `${displayBox?.width ?? 0}px`,
        height: `${displayBox?.height ?? 0}px`,
        opacity,
        transition: "opacity 300ms ease-in-out, transform 100ms linear",
        willChange: "transform, opacity",
      };

      return (
        <div key={id} className="bounding-box" style={boxStyle}>
          {name && (
            <div className="name-tag">
              <div className="name">{name}</div>
              {history && history.length > 0 && (
                <div className="history">{history.join(" - ")}</div>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="App">
      {initializationError ? (
        <div className="overlay">
          <div
            className="overlay-content"
            style={{ maxWidth: "600px", textAlign: "center" }}
          >
            <h2>Lỗi Khởi Tạo</h2>
            <p
              className="status-text error-text"
              style={{ fontSize: "1.2rem", lineHeight: "1.6" }}
            >
              {initializationError}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="video-wrapper" ref={wrapperRef}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="background-video"
            />
            {renderBoundingBoxes()}
          </div>

          <div className="ui-container">
            <header className="App-header">
              <div className="logo">
                {isLoggedIn && classroomInfo
                  ? classroomInfo.name.toUpperCase()
                  : "TRẠM ĐIỂM DANH"}
              </div>
              <nav>
                {isLoggedIn ? (
                  <>
                    <button
                      onClick={() => activeOverlay !== null && closeOverlay()}
                      className={activeOverlay === null ? "active" : ""}
                    >
                      Điểm danh
                    </button>
                    <button
                      onClick={() => handleAdminAction("register")}
                      className={activeOverlay === "register" ? "active" : ""}
                    >
                      Đăng ký
                    </button>
                    <button
                      onClick={() => handleAdminAction("manage")}
                      className={activeOverlay === "manage" ? "active" : ""}
                    >
                      Quản lý
                    </button>
                    <button onClick={handleLogout}>Đăng xuất</button>
                  </>
                ) : (
                  <button onClick={() => setShowLogin(true)}>Đăng nhập</button>
                )}
              </nav>
            </header>

            <div className="fullscreen-controls">
              <button onClick={toggleFullscreen}>
                {isFullscreen ? "Thoát" : "Toàn màn hình"}
              </button>
            </div>

            {showLogin && (
              <div className="overlay">
                <div className="overlay-content login-modal">
                  <button
                    onClick={() => setShowLogin(false)}
                    className="close-btn"
                  >
                    ×
                  </button>
                  <h2>Đăng nhập Admin</h2>
                  <form onSubmit={handleLogin}>
                    <input
                      type="text"
                      placeholder="Tên đăng nhập"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                    />
                    <input
                      type="password"
                      placeholder="Mật khẩu"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    {loginError && (
                      <p className="status-text error-text">{loginError}</p>
                    )}
                    <button type="submit" className="btn-primary">
                      Đăng nhập
                    </button>
                  </form>
                </div>
              </div>
            )}

            {activeOverlay === "register" && (
              <div className="overlay">
                <div className="overlay-content register-modal">
                  <button onClick={closeOverlay} className="close-btn">
                    ×
                  </button>
                  <h2>Đăng ký Sinh viên mới</h2>
                  <form onSubmit={handleRegister} className="register-form">
                    <div className="form-fields">
                      <input
                        type="text"
                        placeholder="Họ và tên"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                      <input
                        type="text"
                        placeholder="Mã sinh viên"
                        value={studentCode}
                        onChange={(e) => setStudentCode(e.target.value)}
                        required
                      />
                    </div>
                    <div className="camera-section">
                      <div className="register-video-container">
                        {preview ? (
                          <img
                            src={preview}
                            alt="Preview"
                            className="preview-image"
                          />
                        ) : (
                          <div className="placeholder">
                            Ảnh chân dung sẽ hiện ở đây
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleCaptureForRegister}
                        className="btn-secondary"
                      >
                        Chụp ảnh
                      </button>
                    </div>
                    <button type="submit" className="btn-primary btn-submit">
                      Hoàn tất Đăng ký
                    </button>
                    {registerStatus && (
                      <p className="status-text">{registerStatus}</p>
                    )}
                  </form>
                </div>
              </div>
            )}

            {activeOverlay === "manage" && (
              <div className="overlay">
                <div className="overlay-content manage-modal">
                  <button onClick={closeOverlay} className="close-btn">
                    ×
                  </button>
                  <h2>Quản lý Sinh viên</h2>
                  <div className="student-list">
                    <table>
                      <thead>
                        <tr>
                          <th>Mã SV</th>
                          <th>Họ tên</th>
                          <th>Hành động</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((student) => (
                          <tr key={student.id}>
                            <td>{student.student_code}</td>
                            <td>{student.name}</td>
                            <td>
                              <button
                                onClick={() =>
                                  handleDelete(student.student_code)
                                }
                                className="btn-danger"
                              >
                                Xóa
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
export default AttendanceStation;
