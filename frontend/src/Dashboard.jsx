import React from "react";
import AdminDashboard from "./AdminDashboard";
import TeacherDashboard from "./TeacherDashboard";

function Dashboard({ role }) {
  if (role === "admin") {
    return <AdminDashboard />;
  } else if (role === "teacher") {
    return <TeacherDashboard />;
  } else {
    return <div>Invalid role</div>;
  }
}

export default Dashboard;
