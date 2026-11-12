// Use the website's own origin in production and CRA's proxy in development.
export const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, "");

let csrfToken = null;
let csrfRequest = null;

export const setCsrfToken = (value) => { csrfToken = value; };

export async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) {
      if (!csrfRequest) {
        csrfRequest = fetch(`${API_BASE_URL}/api/session`, { credentials: "include" })
          .then(async (response) => {
            if (!response.ok) throw new Error("Unable to start a secure session.");
            const data = await response.json();
            setCsrfToken(data.csrfToken);
          })
          .finally(() => { csrfRequest = null; });
      }
      await csrfRequest;
    }
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(url, { ...options, headers, credentials: "include" });
  if (response.status === 401 && !url.endsWith("/api/login")) {
    setCsrfToken(null);
    window.dispatchEvent(new Event("auth-expired"));
  }
  return response;
}
