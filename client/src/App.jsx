import { useEffect, useState } from "react";
import Login from "./components/login/Login";
import Dashboard from "./components/dashboard/Dashboard";
import "./App.css";

const AUTH_STORAGE_KEY = "ttw_admin_authenticated";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLoginSuccess = () => {
    localStorage.setItem(AUTH_STORAGE_KEY, "true");
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthenticated(false);
  };

  return (
    <main className="app-shell">
      {isAuthenticated ? (
        <Dashboard onLogout={handleLogout} />
      ) : (
        <Login onSuccess={handleLoginSuccess} />
      )}
    </main>
  );
}

export default App;
