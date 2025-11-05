import { useEffect, useState } from "react";
import "./dashboard.css";

const API_BASE_URL = "http://localhost:5001/api";

const Dashboard = ({ onLogout }) => {
  const [emailInput, setEmailInput] = useState("");
  const [emails, setEmails] = useState([]);
  const [error, setError] = useState("");
  const [isLightMode, setIsLightMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [removingEmail, setRemovingEmail] = useState("");

  useEffect(() => {
    const fetchEmails = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/emails`);
        const data = await response.json();
        if (response.ok) {
          setEmails(data.emails || []);
        } else {
          setError(data.error || "Unable to load saved emails.");
        }
      } catch (err) {
        setError("Unable to reach the server. Please try again.");
      }
    };

    fetchEmails();
  }, []);

  const handleAddEmail = () => {
    const value = emailInput.trim();
    if (!value) {
      setError("Please enter an email ID.");
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    fetch(`${API_BASE_URL}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to add email.");
        }
        setEmails(data.emails || []);
        setEmailInput("");
        setError("");
      })
      .catch((err) => setError(err.message || "Unexpected error occurred."))
      .finally(() => setIsSaving(false));
  };

  const handleRemoveEmail = (email) => {
    setRemovingEmail(email);
    fetch(`${API_BASE_URL}/emails`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to remove email.");
        }
        setEmails(data.emails || []);
      })
      .catch((err) => setError(err.message || "Unexpected error occurred."))
      .finally(() => setRemovingEmail(""));
  };

  return (
    <section className={`dashboard-shell ${isLightMode ? "light" : ""}`}>
      <nav className="dashboard-nav">
        <div className="nav-title">Email Dashboard</div>
        <div className="nav-actions">
          <button
            className="mode-toggle"
            onClick={() => setIsLightMode((prev) => !prev)}
            aria-label="Toggle color mode"
          >
            <span className="material-symbols-rounded">
              {isLightMode ? "dark_mode" : "light_mode"}
            </span>
            {isLightMode ? "Dark" : "Light"}
          </button>
          <button className="nav-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      </nav>

      <div className="dashboard-toolbar">
        <div className="search-box">
          <span className="material-symbols-rounded">search</span>
          <input
            type="text"
            placeholder="Search by Email ID"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />
        </div>

        <button
          className="primary-btn"
          onClick={handleAddEmail}
          disabled={isSaving}
        >
          {isSaving ? "Adding..." : "Add"}
        </button>
      </div>
      {error && <p className="toolbar-error">{error}</p>}

      {emails.length > 0 && (
        <ul className="email-list">
          {emails.map((email) => (
            <li key={email}>
              <span>{email}</span>
              <div className="email-actions">
                <button className="ghost-btn">Sign In</button>
                <button
                  className="ghost-btn danger"
                  onClick={() => handleRemoveEmail(email)}
                  disabled={removingEmail === email}
                >
                  {removingEmail === email ? "Removing..." : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* <div className="dashboard-content">
        <h2>Welcome back, Admin ??</h2>
        <p>You are now logged in as the TTW administrator.</p>
      </div> */}
    </section>
  );
};

export default Dashboard;
