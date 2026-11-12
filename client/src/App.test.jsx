import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { apiFetch } from "./lib/api";

jest.mock("./lib/api", () => ({ API_BASE_URL: "", apiFetch: jest.fn(), setCsrfToken: jest.fn() }));
jest.mock("./components/login/Login", () => () => <p>Login screen</p>);
jest.mock("./components/dashboard/Dashboard", () => ({ onLogout }) => <button onClick={onLogout}>Logout</button>);
jest.mock("./components/emailApp/emailApp", () => () => <p>Mailbox screen</p>);
jest.mock("./components/analytics/Analytics", () => () => <p>Analytics screen</p>);

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset();
});

test("a saved browser login flag does not grant access", async () => {
  localStorage.setItem("ttw_admin_authenticated", "true");
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ authenticated: false, csrfToken: "token" }) });
  render(<App />);
  expect(await screen.findByText("Login screen")).toBeTruthy();
  expect(localStorage.getItem("ttw_admin_authenticated")).toBeNull();
});

test("a valid server session restores the saved mailbox", async () => {
  localStorage.setItem("ttw_active_mailbox", "mailbox@example.com");
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, csrfToken: "token" }) });
  render(<App />);
  expect(await screen.findByText("Mailbox screen")).toBeTruthy();
});

test("logout calls the server before returning to login", async () => {
  apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: true, csrfToken: "token" }) });
  apiFetch.mockResolvedValueOnce({ ok: true });
  render(<App />);
  fireEvent.click(await screen.findByText("Logout"));
  expect(await screen.findByText("Login screen")).toBeTruthy();
  expect(apiFetch).toHaveBeenCalledWith("/api/logout", { method: "POST" });
});

test("session expiry returns the user to login", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ authenticated: true, csrfToken: "token" }) });
  render(<App />);
  await screen.findByText("Logout");
  act(() => window.dispatchEvent(new Event("auth-expired")));
  await waitFor(() => expect(screen.getByText("Login screen")).toBeTruthy());
});
