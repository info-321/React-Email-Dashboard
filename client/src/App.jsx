import { useEffect, useState } from "react";
import Login from "./components/login/Login";
import Dashboard from "./components/dashboard/Dashboard";
import EmailApp from "./components/emailApp/emailApp";
import Analytics from "./components/analytics/Analytics";
import "./App.css";

const AUTH_STORAGE_KEY = "ttw_admin_authenticated";
const ACTIVE_MAILBOX_KEY = "ttw_active_mailbox";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem(AUTH_STORAGE_KEY) === "true"
  );
  const [activeMailbox, setActiveMailbox] = useState(() =>
    localStorage.getItem(ACTIVE_MAILBOX_KEY)
  );
  const [isLightMode, setIsLightMode] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_MAILBOX_KEY);
      setActiveMailbox(null);
      setShowAnalytics(false);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, "true");
      setActiveMailbox((prev) => prev || localStorage.getItem(ACTIVE_MAILBOX_KEY));
    }
  }, [isAuthenticated]);

  const handleLoginSuccess = () => {
    localStorage.setItem(AUTH_STORAGE_KEY, "true");
    setActiveMailbox(localStorage.getItem(ACTIVE_MAILBOX_KEY));
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_MAILBOX_KEY);
    setActiveMailbox(null);
    setIsAuthenticated(false);
    setShowAnalytics(false);
  };

  const handleEnterMailbox = (email) => {
    localStorage.setItem(ACTIVE_MAILBOX_KEY, email);
    setActiveMailbox(email);
    setShowAnalytics(false);
  };

  const handleExitMailbox = () => {
    localStorage.removeItem(ACTIVE_MAILBOX_KEY);
    setActiveMailbox(null);
    setShowAnalytics(false);
  };
  const toggleTheme = () => setIsLightMode((prev) => !prev);

  let content = null;
  if (!isAuthenticated) {
    content = <Login onSuccess={handleLoginSuccess} />;
  } else if (activeMailbox && showAnalytics) {
    content = <Analytics onBack={() => setShowAnalytics(false)} mailbox={activeMailbox} />;
  } else if (activeMailbox) {
    content = (
      <EmailApp
        mailbox={activeMailbox}
        onBack={handleExitMailbox}
        isLightMode={isLightMode}
        onToggleTheme={toggleTheme}
        onOpenAnalytics={() => setShowAnalytics(true)}
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
