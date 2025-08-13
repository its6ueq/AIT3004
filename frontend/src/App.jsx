import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import AttendanceStation from "./AttendanceStation";
import Dashboard from "./Dashboard";

const ProtectedAdminRoute = ({ children }) => {
  const token = localStorage.getItem("admin_token");
  return token ? children : <Navigate to="/" replace />;
};

const ProtectedTeacherRoute = ({ children }) => {
  const token = localStorage.getItem("teacher_token");
  return token ? children : <Navigate to="/" replace />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AttendanceStation />} />

        <Route
          path="/admin-dashboard"
          element={
            <ProtectedAdminRoute>
              <Dashboard role="admin" />
            </ProtectedAdminRoute>
          }
        />

        <Route
          path="/teacher-dashboard"
          element={
            <ProtectedTeacherRoute>
              <Dashboard role="teacher" />
            </ProtectedTeacherRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
