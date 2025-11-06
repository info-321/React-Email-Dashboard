import { useEffect, useState } from "react";
import Login from "./components/login/Login";
import Dashboard from "./components/dashboard/Dashboard";
import EmailApp from "./components/emailApp/emailApp";
import "./App.css";

const AUTH_STORAGE_KEY = "ttw_admin_authenticated";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeMailbox, setActiveMailbox] = useState(null);
  const [isLightMode, setIsLightMode] = useState(false);

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
    setActiveMailbox(null);
    setIsAuthenticated(false);
  };

  const handleEnterMailbox = (email) => setActiveMailbox(email);
  const handleExitMailbox = () => setActiveMailbox(null);
  const toggleTheme = () => setIsLightMode((prev) => !prev);

  let content = null;
  if (!isAuthenticated) {
    content = <Login onSuccess={handleLoginSuccess} />;
  } else if (activeMailbox) {
    content = (
      <EmailApp
        mailbox={activeMailbox}
        onBack={handleExitMailbox}
        isLightMode={isLightMode}
        onToggleTheme={toggleTheme}
      />
    );
  } else {
    content = (
      <Dashboard
        onLogout={handleLogout}
        onSignInMailbox={handleEnterMailbox}
        isLightMode={isLightMode}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return <main className="app-shell">{content}</main>;
}

export default App;
