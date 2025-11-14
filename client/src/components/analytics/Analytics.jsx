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

const formatPercent = (value) => {
  const numeric = Number(value);
  return `${Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00"}%`;
};

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

  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const step = totalPoints > 1 ? chartWidth / (totalPoints - 1) : 0;
  const maxValue = Math.max(
    ...series.flatMap((item) => item.points.map((point) => point.value || 0)),
    100
  );
  const axisLabels = series[0]?.points?.map((point) => point.date) || [];

  const paths = series.map((item) => {
    const path = (item.points || []).map((point, index) => {
      const x = padding + index * step;
      const percent = Math.min(point.value || 0, maxValue) / maxValue;
      const y = height - padding - percent * chartHeight;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    });
    return { color: item.color, label: item.label, d: path.join(" ") };
  });

  return (
    <div className="line-chart">
      <svg width={width} height={height} role="img" aria-label="Email data chart">
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="axis"
        />
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={height - padding}
          className="axis"
        />
        {paths.map((path) => (
          <path
            key={path.label}
            d={path.d}
            fill="none"
            stroke={path.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
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

  const maxValue = Math.max(
    ...devices.map((item) => Math.max(item.opened || 0, item.clicked || 0)),
    1
  );

  return (
    <div className="device-chart">
      <div className="chart-legend compact">
        <span>
          <i className="opened" /> Opened
        </span>
        <span>
          <i className="clicked" /> Clicked
        </span>
      </div>
      {devices.map((device) => (
        <div className="device-row" key={device.device}>
          <div className="device-label">
            <p>{device.device}</p>
            <small>
              {Math.round(device.opened) || 0} opened /{" "}
              {Math.round(device.clicked) || 0} clicks
            </small>
          </div>
          <div className="device-bars">
            <span
              className="bar opened"
              style={{ width: `${(device.opened / maxValue) * 100}%` }}
            />
            <span
              className="bar clicked"
              style={{ width: `${(device.clicked / maxValue) * 100}%` }}
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
                <small>Opened vs Clicks</small>
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
                  placeholder="Search campaigns"
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
                  <th>Email / Campaign</th>
                  <th>Publish date</th>
                  <th>Sent</th>
                  <th>Click-through</th>
                  <th>Delivered</th>
                  <th>Unsubscribed</th>
                  <th>Spam</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="7" className="table-loading">
                      Loading analytics...
                    </td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="table-empty">
                      No campaigns match your search.
                    </td>
                  </tr>
                )}
                {!loading &&
                  paginatedRows.map((row) => (
                    <tr key={`${row.email}-${row.publishDate}`}>
                      <td>{row.email}</td>
                      <td>{formatDate(row.publishDate)}</td>
                      <td>{formatNumber(row.sent)}</td>
                      <td>{formatPercent(row.clickRate)}</td>
                      <td>{formatPercent(row.deliveredRate)}</td>
                      <td>{formatPercent(row.unsubscribeRate)}</td>
                      <td>{formatPercent(row.spamRate)}</td>
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
        </section>
        {loading && <div className="analytics-loader">Syncing data...</div>}
      </main>
    </div>
  );
};

export default Analytics;
