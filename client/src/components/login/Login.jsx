import { useState } from "react";
import "./login.css";

const Login = ({ onSuccess }) => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = ({ target: { name, value } }) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("http://localhost:5001/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to login");
      }

      if (typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setError(err.message || "Unexpected error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <img src="/Images/TTWLogo.png" alt="TTW logo" />
        </div>

        <h1 className="login-title">TTW Admin Login</h1>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="material-symbols-rounded">person</span>
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
              required
            />
          </label>

          <label className="field">
            <span className="material-symbols-rounded">lock</span>
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="login-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing In..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
