import { useEffect, useMemo, useState } from "react";
import "./analytics.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001";
const TABLE_PAGE_SIZE = 10;

const defaultRange = () => {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  return {
    start: start.toISOString().slice(0, 10),
    end,
  };
};

const formatNumber = (value) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.round(value ?? 0)
  );

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const compactWhitespace = (value = "") =>
  value.replace(/\s+/g, " ").trim();

const stripHtml = (value = "") => {
  if (!value) return "";
  if (typeof window === "undefined") {
    return value.replace(/<[^>]+>/g, " ");
  }
  const temp = window.document.createElement("div");
  temp.innerHTML = value;
  return temp.textContent || temp.innerText || "";
};

const escapeHtml = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const sanitizeHtml = (value = "") => {
  if (!value) return "";
  if (typeof window === "undefined") {
    return value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  }
  const parser = new window.DOMParser();
  const jsPrefix = ["java", "script:"].join("");
  const doc = parser.parseFromString(value, "text/html");
  doc.querySelectorAll("script,style,link,meta").forEach((node) => node.remove());
  doc.body.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      const attrValue = (attr.value || "").toLowerCase().trim();
      if (attrName.startsWith("on") || attrValue.startsWith(jsPrefix)) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const buildAttachmentUrl = (mailbox, messageId, attachment) => {
  if (!mailbox || !messageId || !attachment?.attachmentId) return "#";
  const baseUrl = `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
    mailbox
  )}/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(
    attachment.attachmentId
  )}`;
  const params = new URLSearchParams();
  if (attachment.filename) params.append("filename", attachment.filename);
  if (attachment.mimeType) params.append("mimeType", attachment.mimeType);
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
};

const buildMessagePreview = (message) => {
  const plain = compactWhitespace(message?.bodyPlain || "");
  if (plain) return plain;
  const htmlText = compactWhitespace(stripHtml(message?.bodyHtml || ""));
  if (htmlText) return htmlText;
  return compactWhitespace(message?.snippet || "");
};

const buildMessageHtml = (message) => {
  if (message?.bodyHtml) {
    const cleaned = sanitizeHtml(message.bodyHtml);
    if (cleaned) return cleaned;
  }
  const fallback = message?.bodyPlain || message?.snippet || "";
  if (!fallback) return "";
  return escapeHtml(fallback).replace(/\n/g, "<br />");
};

const PREVIEW_CHAR_LIMIT = 280;

const LineChart = ({ series = [], height = 220 }) => {
  const width = 520;
  const padding = 32;
  const totalPoints = Math.max(
    ...series.map((item) => item.points?.length || 0),
    0
  );
  if (!totalPoints) {
    return <div className="chart-empty">No timeline data</div>;
  }

  const chartWidth = width - padding * 3;
  const chartHeight = height - padding * 2;
  const step = totalPoints > 1 ? chartWidth / (totalPoints - 1) : 0;
  const maxValue = Math.max(
    ...series.flatMap((item) => item.points.map((point) => point.value || 0)),
    100
  );
  const axisLabels = series[0]?.points?.map((point) => point.date) || [];

  const paths = series.map((item) => {
    const points = (item.points || []).map((point, index) => {
      const x = padding * 2 + index * step;
      const percent = Math.min(point.value || 0, maxValue) / maxValue;
      const y = height - padding - percent * chartHeight;
      return { x, y, date: point.date, value: point.value || 0 };
    });
    const d = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
      .join("");
    return { color: item.color, label: item.label, d, points };
  });

  const yTicks = maxValue ? [0, Math.round(maxValue / 2), maxValue] : [0];

  return (
    <div className="line-chart">
      <svg width={width} height={height} role="img" aria-label="Email data chart">
        {yTicks.map((tick) => {
          const y = height - padding - (tick / (maxValue || 1)) * chartHeight;
          return (
            <g key={tick}>
              <line
                x1={padding * 2 - 8}
                y1={y}
                x2={width - padding}
                y2={y}
                className="grid-line"
              />
              <text x={padding} y={y + 4} className="axis-label">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        {paths.map((path) => (
          <g key={path.label}>
            <path
              d={path.d}
              fill="none"
              stroke={path.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {path.points.map((point) => (
              <circle
                key={`${path.label}-${point.date}`}
                cx={point.x}
                cy={point.y}
                r={3}
                fill={path.color}
              >
                <title>
                  {path.label}: {formatNumber(point.value)} on {formatDate(point.date)}
                </title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="chart-axis-labels">
        {axisLabels.map((label, index) => (
          <span key={`${label}-${index}`}>{formatDate(label)}</span>
        ))}
      </div>
      <div className="chart-legend">
        {series.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const DeviceChart = ({ devices = [] }) => {
  if (!devices.length) {
    return <div className="chart-empty">No device breakdown yet</div>;
  }

  const maxValue = Math.max(...devices.map((item) => item.opened || 0), 1);

  return (
    <div className="device-chart">
      {devices.map((device) => (
        <div className="device-row" key={device.device}>
          <div className="device-label">
            <p>{device.device}</p>
            <small>{Math.round(device.opened) || 0} mails</small>
          </div>
          <div className="device-bars">
            <span
              className="bar opened"
              style={{ width: `${(device.opened / maxValue) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const Analytics = ({ mailbox, onBack }) => {
  const presets = defaultRange();
  const [startDate, setStartDate] = useState(presets.start);
  const [endDate, setEndDate] = useState(presets.end);
  const [refreshToken, setRefreshToken] = useState(0);
  const [tableQuery, setTableQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [isLightMode, setIsLightMode] = useState(false);
  const [drawerState, setDrawerState] = useState({
    open: false,
    loading: false,
    peer: "",
    direction: "sent",
    messages: [],
    error: "",
  });
  const [expandedMessages, setExpandedMessages] = useState(() => new Set());

  const dataSourceLabel =
    data?.source === "gmail"
      ? "Gmail"
      : data?.source === "sample"
      ? "sample dataset"
      : "Notion";
  const metrics = data?.metrics || {};
  const percentDisplay = (value) =>
    `${Math.min(100, Math.max(0, Number(value) || 0)).toFixed(2)}%`;

  const metricCardsTop = [
    {
      label: "Sent",
      value: formatNumber(metrics.sentCount ?? 0),
      helper: percentDisplay(metrics.deliveredRate ?? 0),
    },
    {
      label: "Open",
      value: formatNumber(metrics.openCount ?? 0),
      helper: "Total opens",
    },
    {
      label: "Open rate",
      value: percentDisplay(metrics.openRate ?? 0),
      helper: "Share of delivered",
    },
  ];

  const metricCardsBottom = [
    {
      label: "All Mails",
      value: formatNumber(metrics.deliveredCount ?? 0),
      helper: percentDisplay(metrics.deliveredRate ?? 0),
    },
    {
      label: "Bounce rate",
      value: percentDisplay(metrics.bounceRate ?? 0),
      helper: `${formatNumber(metrics.sentCount ?? 0)} mails sent`,
    },
    {
      label: "Spam report rate",
      value: percentDisplay(metrics.spamRate ?? 0),
      helper: "Share of sent",
    },
  ];

  useEffect(() => {
    if (startDate && endDate && startDate > endDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    const controller = new AbortController();
    const loadAnalytics = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ range: "custom" });
        if (mailbox) params.append("mailbox", mailbox);
        if (startDate) params.append("startDate", startDate);
        if (endDate) params.append("endDate", endDate);
        const response = await fetch(
          `${API_BASE_URL}/api/analytics/notion?${params.toString()}`,
          { signal: controller.signal }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load analytics.");
        }
        setData(payload);
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(err.message || "Unexpected analytics error.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    loadAnalytics();
    return () => controller.abort();
  }, [mailbox, refreshToken, startDate, endDate]);

  const filteredRows = useMemo(() => {
    if (!data?.table) return [];
    if (!tableQuery.trim()) return data.table;
    const query = tableQuery.trim().toLowerCase();
    return data.table.filter(
      (row) =>
        row.email.toLowerCase().includes(query) ||
        (row.publishDate || "").toLowerCase().includes(query)
    );
  }, [data, tableQuery]);

  useEffect(() => {
    setPage(1);
    setDrawerState((prev) => ({ ...prev, open: false, messages: [], error: "" }));
  }, [tableQuery, filteredRows.length]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRows.length / TABLE_PAGE_SIZE)
  );
  const paginatedRows = filteredRows.slice(
    (page - 1) * TABLE_PAGE_SIZE,
    page * TABLE_PAGE_SIZE
  );

  const handleRefresh = () => setRefreshToken((prev) => prev + 1);
  const toggleTheme = () => setIsLightMode((prev) => !prev);
  const toggleMessageExpansion = (messageId) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const closeDrawer = () => {
    setExpandedMessages(new Set());
    setDrawerState((prev) => ({ ...prev, open: false, messages: [], error: "" }));
  };

  const fetchPeerMessages = async (peer, direction) => {
    if (!mailbox || !peer) {
      return;
    }
    setDrawerState({
      open: true,
      loading: true,
      peer,
      direction,
      messages: [],
      error: "",
    });
    try {
      const params = new URLSearchParams({
        peer,
        direction,
        startDate,
        endDate,
      });
      const response = await fetch(
        `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
          mailbox
        )}/peer-messages?${params.toString()}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load messages.");
      }
      setDrawerState((prev) => ({
        ...prev,
        loading: false,
        messages: payload.messages || [],
      }));
      setExpandedMessages(new Set());
    } catch (err) {
      setDrawerState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Unexpected error.",
      }));
    }
  };

  return (
    <div className={`analytics-shell ${isLightMode ? "light" : ""}`}>
      <main className="analytics-content">
        <header className="analytics-header">
          <div className="header-meta">
            <h1>Email Analytics</h1>
            <p>
              {mailbox
                ? `Workspace mailbox: ${mailbox}`
                : data?.generatedAt
                ? `Updated ${formatDate(data.generatedAt)}`
                : "Overview powered by Notion"}
            </p>
          </div>
          <div className="header-actions">
            {onBack && (
              <button
                type="button"
                className="ghost"
                onClick={onBack}
                aria-label="Back to mailbox"
              >
                <span className="material-symbols-rounded">arrow_back</span>
                Back
              </button>
            )}
            <div className="date-range">
              <label>
                Start
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={toggleTheme}
              aria-label="Toggle color mode"
            >
              <span className="material-symbols-rounded">
                {isLightMode ? "dark_mode" : "light_mode"}
              </span>
              {isLightMode ? "Dark" : "Light"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={handleRefresh}
              disabled={loading}
            >
              <span className="material-symbols-rounded">refresh</span>
              Refresh
            </button>
            <button type="button" className="primary">
              Save report
            </button>
          </div>
        </header>

        {error && <div className="analytics-error">{error}</div>}

        <section className="analytics-cards top-row">
          {metricCardsTop.map((card) => (
            <article className="stat-card" key={card.label}>
              <div className="stat-card-top">
                <p>{card.label}</p>
              </div>
              <h3>{card.value}</h3>
              <small>{card.helper}</small>
            </article>
          ))}
        </section>

        <section className="analytics-cards bottom-row">
          {metricCardsBottom.map((card) => (
            <article className="stat-card" key={card.label}>
              <div className="stat-card-top">
                <p>{card.label}</p>
              </div>
              <h3>{card.value}</h3>
              <small>{card.helper}</small>
            </article>
          ))}
        </section>

        <section className="chart-grid">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p>Email data chart</p>
                <small>Click-through vs open rate</small>
              </div>
            </div>
            <LineChart series={data?.lineSeries || []} />
          </article>
          <article className="panel">
            <div className="panel-head">
              <div>
                <p>Performance by device</p>
              </div>
            </div>
            <DeviceChart devices={data?.devices || []} />
          </article>
        </section>

        <section className="table-panel">
          <header>
            <div>
              <h3>All email performance</h3>
              <p>Campaigns synced from {dataSourceLabel}</p>
            </div>
            <div className="table-actions">
              <div className="search">
                <span className="material-symbols-rounded">search</span>
                <input
                  type="text"
                  placeholder="Search recipients"
                  value={tableQuery}
                  onChange={(event) => setTableQuery(event.target.value)}
                />
              </div>
              <button type="button" className="ghost">
                Manage columns
              </button>
              <button type="button" className="ghost">
                Export
              </button>
            </div>
          </header>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Sent</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="3" className="table-loading">
                      Loading analytics...
                    </td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan="3" className="table-empty">
                      No entries in this range.
                    </td>
                  </tr>
                )}
                {!loading &&
                  paginatedRows.map((row) => (
                    <tr key={`${row.email}-${row.sent}-${row.received}`}>
                      <td>{row.email}</td>
                      <td>
                        <button
                          type="button"
                          className="link-cell"
                          onClick={() => fetchPeerMessages(row.email, "sent")}
                          disabled={!row.sent}
                        >
                          {formatNumber(row.sent ?? 0)}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-cell"
                          onClick={() => fetchPeerMessages(row.email, "received")}
                          disabled={!row.received}
                        >
                          {formatNumber(row.received ?? 0)}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <footer>
            <button
              type="button"
              className="ghost"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
            >
              Previous
            </button>
            <span>
              Page {Math.min(page, totalPages)} of {totalPages}
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                setPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={page >= totalPages}
            >
              Next
            </button>
          </footer>

          <div className={`mail-drawer ${drawerState.open ? "open" : ""}`}>
            <div className="drawer-header">
              <div>
                <p>
                  {drawerState.direction === "sent"
                    ? "Sent mails to"
                    : "Received mails from"}
                </p>
                <h4>{drawerState.peer}</h4>
              </div>
              <button type="button" onClick={closeDrawer}>
                <span className="material-symbols-rounded">close</span>
              </button>
            </div>
            {drawerState.loading && (
              <p className="drawer-status">Loading messages...</p>
            )}
            {drawerState.error && (
              <p className="drawer-status error">{drawerState.error}</p>
            )}
            {!drawerState.loading &&
              !drawerState.error &&
              !drawerState.messages.length && (
                <p className="drawer-status">No messages found in this range.</p>
              )}
            <ul className="drawer-list">
              {drawerState.messages.map((message) => {
                const previewText = buildMessagePreview(message);
                const isExpanded = expandedMessages.has(message.id);
                const showToggle = previewText.length > PREVIEW_CHAR_LIMIT;
                const truncatedPreview = showToggle
                  ? `${previewText.slice(0, PREVIEW_CHAR_LIMIT)}…`
                  : previewText;
                const messageHtml = isExpanded ? buildMessageHtml(message) : "";
                const attachments = message.attachments || [];
                return (
                  <li key={message.id}>
                    <p className="msg-subject">
                      {message.subject || "(No subject)"}
                    </p>
                    <small>
                      {formatDate(message.date)} {" • "}
                      {drawerState.direction === "sent"
                        ? `To ${message.to || drawerState.peer}`
                        : `From ${message.from || drawerState.peer}`}
                    </small>
                    {previewText && (
                      <p
                        className={`msg-snippet ${
                          isExpanded ? "expanded" : ""
                        }`}
                      >
                        {isExpanded || !showToggle
                          ? previewText
                          : truncatedPreview}
                      </p>
                    )}
                    {isExpanded && messageHtml && (
                      <div
                        className="msg-body"
                        dangerouslySetInnerHTML={{ __html: messageHtml }}
                      />
                    )}
                    {showToggle && (
                      <button
                        type="button"
                        className="drawer-toggle"
                        onClick={() => toggleMessageExpansion(message.id)}
                      >
                        {isExpanded ? "Show less" : "Read more"}
                      </button>
                    )}
                    {attachments.length > 0 && (
                      <div className="drawer-attachments">
                        {attachments.map((attachment) => {
                          const href = buildAttachmentUrl(
                            mailbox,
                            message.id,
                            attachment
                          );
                          const attachmentKey =
                            attachment.attachmentId ||
                            attachment.filename ||
                            attachment.mimeType;
                          return (
                            <a
                              key={`${message.id}-${attachmentKey}`}
                              href={href}
                              target={href === "#" ? "_self" : "_blank"}
                              rel="noopener noreferrer"
                              className={`attachment-chip${
                                href === "#" ? " disabled" : ""
                              }`}
                            >
                              <span className="material-symbols-rounded">
                                attach_file
                              </span>
                              <div>
                                <p>
                                  {attachment.filename ||
                                    attachment.mimeType ||
                                    "Attachment"}
                                </p>
                                {attachment.size ? (
                                  <small>{formatBytes(attachment.size)}</small>
                                ) : null}
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        {loading && <div className="analytics-loader">Syncing data...</div>}
      </main>
    </div>
  );
};

export default Analytics;
