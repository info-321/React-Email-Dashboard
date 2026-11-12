import "whatwg-fetch";
import { API_BASE_URL, apiFetch, setCsrfToken } from "./api";

beforeEach(() => {
  global.fetch = jest.fn();
  setCsrfToken(null);
});

test("requests use the same origin with session cookies by default", async () => {
  expect(API_BASE_URL).toBe("");
  fetch.mockResolvedValue({ status: 200 });
  await apiFetch("/api/emails");
  expect(fetch).toHaveBeenCalledWith("/api/emails", expect.objectContaining({ credentials: "include" }));
});

test("the first mutation establishes a session and includes its CSRF token", async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "csrf-token" }) });
  fetch.mockResolvedValueOnce({ status: 200 });
  const body = JSON.stringify({ email: "mailbox@example.com" });
  await apiFetch("/api/emails", { method: "POST", body, headers: { "Content-Type": "application/json" } });
  expect(fetch.mock.calls[0][0]).toBe("/api/session");
  const [url, options] = fetch.mock.calls[1];
  expect(url).toBe("/api/emails");
  expect(options.headers.get("X-CSRF-Token")).toBe("csrf-token");
  expect(options.headers.get("Content-Type")).toBe("application/json");
  expect(options.body).toBe(body);
  expect(options.credentials).toBe("include");
});

test("session expiry notifies the app and drops the stale CSRF token", async () => {
  setCsrfToken("stale-token");
  const expired = jest.fn();
  window.addEventListener("auth-expired", expired);
  try {
    fetch.mockResolvedValueOnce({ status: 401 });
    await apiFetch("/api/emails");
    expect(expired).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "new-token" }) });
    fetch.mockResolvedValueOnce({ status: 200 });
    await apiFetch("/api/login", { method: "POST" });
    expect(fetch.mock.calls[1][0]).toBe("/api/session");
    expect(fetch.mock.calls[2][1].headers.get("X-CSRF-Token")).toBe("new-token");
  } finally {
    window.removeEventListener("auth-expired", expired);
  }
});

test("failed CSRF setup does not send a mutation", async () => {
  fetch.mockResolvedValueOnce({ ok: false });
  await expect(apiFetch("/api/emails", { method: "DELETE" })).rejects.toThrow("Unable to start a secure session.");
  expect(fetch).toHaveBeenCalledTimes(1);
});
