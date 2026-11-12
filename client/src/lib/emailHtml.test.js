import { sanitizeHtml, escapeHtml } from "./emailHtml";

test("email preview removes executable markup and embedded forms", () => {
  const html = sanitizeHtml(`
    <script>alert(1)</script>
    <img src="image.png" onerror="alert(1)">
    <svg onload="alert(1)"></svg>
    <a href="javascript:alert(1)">Unsafe link</a>
    <iframe srcdoc="<script>alert(1)</script>"></iframe>
    <form action="/api/logout"><input name="password"></form>
    <style>body { display:none }</style>
    <p style="position:fixed">Message</p>
  `);
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(container.querySelector("script,svg,iframe,form,input,style")).toBeNull();
  expect(container.querySelector("img").hasAttribute("onerror")).toBe(false);
  expect(container.querySelector("a").hasAttribute("href")).toBe(false);
  expect(container.querySelector("p").hasAttribute("style")).toBe(false);
  expect(container.textContent).toContain("Message");
});

test("email preview preserves ordinary HTML and safe links", () => {
  const html = sanitizeHtml('<p>Hello <strong>team</strong></p><a href="https://example.com">Read</a>');
  expect(html).toContain("<strong>team</strong>");
  expect(html).toContain('href="https://example.com"');
});

test("plain text and print fields remain literal text, including entities", () => {
  const container = document.createElement("div");
  const text = '&lt;img onerror="alert(1)"&gt; <script>alert(1)</script>';
  container.innerHTML = escapeHtml(text);
  expect(container.querySelector("script,img")).toBeNull();
  expect(container.textContent).toBe(text);
});
