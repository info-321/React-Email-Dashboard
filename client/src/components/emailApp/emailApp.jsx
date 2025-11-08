import { useEffect, useState } from "react";
import "./EmailApp.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001";
const PAGE_SIZE = 25;

const folderDefinitions = [
  { key: "inbox", name: "Inbox", icon: "inbox" },
  { key: "sent", name: "Sent", icon: "send" },
  { key: "drafts", name: "Drafts", icon: "draft" },
  { key: "starred", name: "Starred", icon: "star" },
  { key: "archive", name: "Archive", icon: "inventory_2" },
  { key: "spam", name: "Spam", icon: "report" },
  { key: "deleted", name: "Deleted", icon: "delete" },
];

const formatTimestamp = (value) => {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatBytes = (size) => {
  if (size === undefined || size === null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
};

const decodeEntities = (input) => {
  if (!input) return "";
  if (typeof document === "undefined") return input;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = input;
  return textarea.value;
};

const buildAttachmentUrl = (mailbox, messageId, attachment) => {
  if (!mailbox || !messageId || !attachment?.attachmentId) return "#";
  const base = `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
    mailbox
  )}/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(
    attachment.attachmentId
  )}`;
  const params = new URLSearchParams();
  if (attachment.filename) params.append("filename", attachment.filename);
  if (attachment.mimeType) params.append("mimeType", attachment.mimeType);
  return `${base}?${params.toString()}`;
};

const EmailApp = ({ mailbox, onBack, isLightMode, onToggleTheme }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [overview, setOverview] = useState({ labels: [], counts: {} });
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");

  const [activeFolder, setActiveFolder] = useState(folderDefinitions[0].key);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [selectedThread, setSelectedThread] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [pageToken, setPageToken] = useState(null);
  const [prevPageTokens, setPrevPageTokens] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [resultEstimate, setResultEstimate] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState({
    to: "",
    subject: "",
    body: "",
  });
  const [composeStatus, setComposeStatus] = useState({
    loading: false,
    error: "",
    success: "",
  });

  useEffect(() => {
    let ignore = false;

    const loadOverview = async () => {
      if (!mailbox) return;
      try {
        setOverviewLoading(true);
        setOverviewError("");
        const response = await fetch(
          `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
            mailbox
          )}/overview`
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load mailbox overview.");
        }
        if (!ignore) {
          setOverview(data);
        }
      } catch (err) {
        if (!ignore) {
          setOverviewError(err.message || "Unexpected error.");
        }
      } finally {
        if (!ignore) {
          setOverviewLoading(false);
        }
      }
    };

    loadOverview();
    return () => {
      ignore = true;
    };
  }, [mailbox]);

  const resetPagination = () => {
    setPageToken(null);
    setPrevPageTokens([]);
    setNextPageToken(null);
    setResultEstimate(null);
    setPageIndex(0);
    setSelectedIds([]);
  };

  useEffect(() => {
    setActiveFolder(folderDefinitions[0].key);
    setSelectedThread(null);
    setThreads([]);
    setSearchInput("");
    setActiveQuery("");
    resetPagination();
  }, [mailbox]);

  useEffect(() => {
    setSelectedThread(null);
    setThreads([]);
    setSearchInput("");
    setActiveQuery("");
    resetPagination();
  }, [activeFolder]);

  useEffect(() => {
    let ignore = false;

    const loadFolderMessages = async () => {
      if (!mailbox || !activeFolder) return;
      try {
        setThreadsLoading(true);
        setThreadsError("");
        const params = new URLSearchParams({ folder: activeFolder });
        if (activeQuery) params.append("query", activeQuery);
        if (pageToken) params.append("pageToken", pageToken);

        const response = await fetch(
          `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
            mailbox
          )}/messages?${params.toString()}`
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load messages.");
        }
        if (!ignore) {
          const hydrated = (data.messages || []).map((message) => ({
            attachments: [],
            hasAttachments: false,
            decodedSnippet: decodeEntities(message.snippet),
            ...message,
          }));
          setThreads(hydrated);
          setSelectedIds([]);
          setNextPageToken(data.nextPageToken || null);
          setResultEstimate(
            typeof data.resultSizeEstimate === "number"
              ? data.resultSizeEstimate
              : null
          );
        }
      } catch (err) {
        if (!ignore) {
          setThreads([]);
          setThreadsError(err.message || "Unable to load messages.");
        }
      } finally {
        if (!ignore) {
          setThreadsLoading(false);
        }
      }
    };

    loadFolderMessages();
    return () => {
      ignore = true;
    };
  }, [mailbox, activeFolder, activeQuery, pageToken, refreshKey]);

  useEffect(() => {
    setSelectedThread((current) => {
      if (!threads.length) return null;
      if (current) {
        const existing = threads.find((thread) => thread.id === current.id);
        if (existing) return existing;
      }
      return threads[0];
    });
  }, [threads]);

  const userLabels =
    overview.labels
      ?.filter(
        (label) =>
          label.type === "user" &&
          label.labelListVisibility !== "hide" &&
          !(label.name || "").startsWith("CATEGORY_")
      ) || [];

  const activeFolderMeta =
    folderDefinitions.find((folder) => folder.key === activeFolder) ||
    folderDefinitions[0];
  const totalForFolder = overview.counts?.[activeFolder];
  const visibleCount = threads.length;
  const totalForLabel =
    resultEstimate ??
    (typeof totalForFolder === "number" ? totalForFolder : visibleCount);
  const startRange = threads.length ? pageIndex * PAGE_SIZE + 1 : 0;
  const endRange = pageIndex * PAGE_SIZE + threads.length;
  const mailCountLabel = `${startRange}-${endRange || 0} of ${
    typeof totalForFolder === "number" ? totalForLabel : "many"
  }`;
  const allSelected =
    threads.length > 0 && selectedIds.length === threads.length;
  const availableTargets =
    selectedIds.length > 0
      ? selectedIds
      : selectedThread
      ? [selectedThread.id]
      : [];
  const canBulkAct = availableTargets.length > 0;

  const handleFolderSelect = (folderKey) => {
    if (folderKey === activeFolder) return;
    setThreads([]);
    setThreadsError("");
    setSelectedThread(null);
    setActiveFolder(folderKey);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    setActiveQuery(trimmed);
    resetPagination();
  };

  const clearSearch = () => {
    setSearchInput("");
    setActiveQuery("");
    resetPagination();
  };

  const goToNextPage = () => {
    if (!nextPageToken) return;
    setPrevPageTokens((prev) => [...prev, pageToken]);
    setPageToken(nextPageToken);
    setPageIndex((prev) => prev + 1);
  };

  const goToPrevPage = () => {
    if (!prevPageTokens.length) return;
    setPrevPageTokens((prev) => {
      const copy = [...prev];
      const prevToken = copy.pop() || null;
      setPageToken(prevToken);
      return copy;
    });
    setPageIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleToggleSelectAll = () => {
    if (!threads.length) return;
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(threads.map((thread) => thread.id));
    }
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleBulkAction = async (action) => {
    if (!mailbox || !availableTargets.length) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
          mailbox
        )}/messages/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: availableTargets, action }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} messages.`);
      }
      setThreads((prev) =>
        prev.filter((thread) => !availableTargets.includes(thread.id))
      );
      setSelectedIds([]);
      if (availableTargets.includes(selectedThread?.id)) {
        setSelectedThread(null);
      }
    } catch (err) {
      setThreadsError(err.message || "Unable to update messages.");
    }
  };

  const handleComposeField = (field, value) => {
    setComposeForm((prev) => ({ ...prev, [field]: value }));
    setComposeStatus((prev) => ({ ...prev, error: "", success: "" }));
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeStatus({ loading: false, error: "", success: "" });
  };

  const handleComposeSubmit = async (event) => {
    event.preventDefault();
    if (!mailbox) return;
    setComposeStatus({ loading: true, error: "", success: "" });
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/mailbox/${encodeURIComponent(mailbox)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(composeForm),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to send email.");
      }
      setComposeForm({ to: "", subject: "", body: "" });
      setComposeStatus({
        loading: false,
        error: "",
        success: "Message sent successfully.",
      });
    } catch (err) {
      setComposeStatus({
        loading: false,
        error: err.message || "Unable to send email.",
        success: "",
      });
    }
  };

  const threadList = (
    <ul className="gmail-thread-list scrollable">
      {threadsLoading && (
        <li className="loading-row">Loading emails...</li>
      )}
      {!threadsLoading && !threads.length && (
        <li className="loading-row">
          {activeQuery ? `No results for "${activeQuery}".` : "No messages in this folder."}
        </li>
      )}
      {!threadsLoading &&
        threads.map((thread) => (
          <li
            key={thread.id}
            className={`${selectedThread?.id === thread.id ? "active" : ""} ${
              selectedIds.includes(thread.id) ? "checked" : ""
            }`}
            onClick={() => setSelectedThread(thread)}
            title="Open thread"
          >
            <div className="thread-preview">
              <p className="thread-sender">
                {thread.from || thread.to || "Unknown sender"}
              </p>
              <p className="thread-subject">{thread.subject}</p>
              <p className="thread-snippet">
                {thread.decodedSnippet || thread.snippet}
              </p>
            </div>
            <span className="thread-time">{formatTimestamp(thread.date)}</span>
          </li>
        ))}
    </ul>
  );

  return (
    <section
      className={`email-shell ${isLightMode ? "light" : ""} ${
        sidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      }`}
    >
      <header className="email-topbar">
        <div className="brand">
          <span className="material-symbols-rounded">mail</span>
          <div>
            <p className="brand-label">TTW Mail</p>
            <small>{mailbox}</small>
          </div>
        </div>
        <div className="top-actions">
          <form className="search-pill" onSubmit={handleSearchSubmit}>
            <span className="material-symbols-rounded">search</span>
            <input
              type="text"
              placeholder="Search mail"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <button
              type="submit"
              className="pill-btn compact"
              disabled={threadsLoading && activeQuery === searchInput.trim()}
              title="Search"
            >
              Go
            </button>
            {activeQuery && (
              <button
                type="button"
                className="icon-only"
                onClick={clearSearch}
                aria-label="Clear search"
                title="Clear filter"
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            )}
          </form>
          <button
            type="button"
            className="mode-toggle"
            onClick={onToggleTheme}
            title={isLightMode ? "Dark mode" : "Light mode"}
          >
            <span className="material-symbols-rounded">
              {isLightMode ? "dark_mode" : "light_mode"}
            </span>
            {isLightMode ? "Dark" : "Light"}
          </button>
          <button
            type="button"
            className="pill-btn ghost"
            onClick={onBack}
            title="Back"
          >
            Back
          </button>
        </div>
      </header>

      <div className="gmail-frame">
        <aside
          className={`gmail-sidebar ${sidebarOpen ? "open" : "collapsed"}`}
        >
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Toggle sidebar"
            title="Sidebar"
          >
            <span className="material-symbols-rounded">menu</span>
          </button>

          <button
            type="button"
            className="pill-btn primary"
            onClick={() => {
              setComposeOpen(true);
              setComposeStatus({ loading: false, error: "", success: "" });
            }}
            title="Compose"
          >
            Compose
          </button>

          <div className="mailbox-menu">
            {folderDefinitions.map((folder) => {
              const count = overview.counts?.[folder.key];
              return (
                <button
                  key={folder.key}
                  type="button"
                  className={`label-item ${
                    folder.key === activeFolder ? "active" : ""
                  }`}
                  onClick={() => handleFolderSelect(folder.key)}
                >
                  <span className="material-symbols-rounded">
                    {folder.icon}
                  </span>
                  <span className="label-text">
                    {folder.name}
                    {typeof count === "number" && (
                      <span className="label-count">{count}</span>
                    )}
                  </span>
                </button>
              );
            })}
            {overviewLoading && <span className="inline-loader stacked" />}
            {overviewError && (
              <p className="overview-error">{overviewError}</p>
            )}
          </div>

          <div className="label-menu labels-section">
            <p className="section-title">Labels</p>
            {userLabels.length === 0 && !overviewLoading && (
              <span className="empty-text">No labels</span>
            )}
            {userLabels.slice(0, 3).map((label) => (
              <button key={label.id} className="label-item" type="button">
                <span className="material-symbols-rounded">label</span>
                <span className="label-text">{label.name}</span>
              </button>
            ))}
            {userLabels.length > 3 && (
              <div className="label-scroll">
                {userLabels.slice(3).map((label) => (
                  <button key={label.id} className="label-item" type="button">
                    <span className="material-symbols-rounded">label</span>
                    <span className="label-text">{label.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="gmail-list-pane">
          <div className="list-controls">
            <div className="control-icons">
              {[
                {
                  icon: allSelected ? "check_box" : "check_box_outline_blank",
                  label: allSelected ? "Clear selection" : "Select",
                  action: handleToggleSelectAll,
                  disabled: !threads.length,
                },
                {
                  icon: "archive",
                  label: "Archive",
                  action: () => handleBulkAction("archive"),
                  disabled: !canBulkAct,
                },
                {
                  icon: "delete",
                  label: "Trash",
                  action: () => handleBulkAction("delete"),
                  disabled: !canBulkAct,
                },
                {
                  icon: "refresh",
                  label: "Refresh",
                  action: handleRefresh,
                  disabled: threadsLoading,
                },
              ].map(({ icon, label, action, disabled }) => (
                <button
                  type="button"
                  key={icon}
                  title={label}
                  onClick={action}
                  disabled={disabled}
                >
                  <span className="material-symbols-rounded">{icon}</span>
                </button>
              ))}
            </div>
            <div className="mail-count">
              <span>{mailCountLabel}</span>
              <button
                type="button"
                title="Prev"
                disabled={!prevPageTokens.length}
                onClick={goToPrevPage}
              >
                <span className="material-symbols-rounded">chevron_left</span>
              </button>
              <button
                type="button"
                title="Next"
                disabled={!nextPageToken}
                onClick={goToNextPage}
              >
                <span className="material-symbols-rounded">chevron_right</span>
              </button>
            </div>
          </div>

          <div className="list-tabs single">
            <button type="button" className="active">
              {activeFolderMeta.name}
              <span className="badge">{threads.length}</span>
            </button>
            {activeQuery && (
              <span className="search-chip">
                Filter: {activeQuery}
                <button type="button" onClick={clearSearch} aria-label="Clear search filter">
                  <span className="material-symbols-rounded">close</span>
                </button>
              </span>
            )}
          </div>

          {threadsError && (
            <div className="feedback feedback-error">
              <p>{threadsError}</p>
              {activeQuery && (
                <button type="button" onClick={clearSearch}>
                  Clear search
                </button>
              )}
            </div>
          )}
          {threadList}
        </section>

        <section className={`gmail-detail-pane ${selectedThread ? "" : "empty"}`}>
          {selectedThread ? (
            <>
              <header className="detail-top">
                <div>
                  <p className="detail-title">{selectedThread.subject}</p>
                  <div className="detail-meta">
                    <small>
                      {selectedThread.from ||
                        selectedThread.to ||
                        "Unknown sender"}
                    </small>
                    {selectedThread.date && (
                      <small>{formatTimestamp(selectedThread.date)}</small>
                    )}
                    {selectedThread.cc && (
                      <small className="detail-cc">Cc: {selectedThread.cc}</small>
                    )}
                  </div>
                </div>
                <div className="detail-top-actions">
                  {[
                    {
                      icon: "archive",
                      label: "Archive",
                      handler: () => handleBulkAction("archive"),
                    },
                    {
                      icon: "delete",
                      label: "Trash",
                      handler: () => handleBulkAction("delete"),
                    },
                    {
                      icon: "mark_email_unread",
                      label: "Refresh",
                      handler: handleRefresh,
                    },
                  ].map(({ icon, label, handler }) => (
                    <button
                      key={icon}
                      type="button"
                      className="icon-btn"
                      title={label}
                      onClick={handler}
                      disabled={!selectedThread}
                    >
                      <span className="material-symbols-rounded">{icon}</span>
                    </button>
                  ))}
                </div>
              </header>

              <article className="gmail-message">
                <p className="message-heading">{selectedThread.subject}</p>
                <p>
                  {selectedThread.decodedSnippet ||
                    selectedThread.snippet ||
                    "No preview available."}
                </p>
                {selectedThread.attachments?.length ? (
                  <div className="attachment-list">
                    {selectedThread.attachments.map((attachment) => (
                      <div
                        className="attachment-chip"
                        key={attachment.attachmentId || attachment.filename}
                      >
                        <span className="material-symbols-rounded">
                          attach_file
                        </span>
                        <div>
                          <p>{attachment.filename || attachment.mimeType}</p>
                          {attachment.size && (
                            <small>{formatBytes(attachment.size)}</small>
                          )}
                        </div>
                        <a
                          href={buildAttachmentUrl(
                            mailbox,
                            attachment.messageId || selectedThread.id,
                            attachment
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Download"
                        >
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            </>
          ) : (
            <div className="empty-detail">
              <p>Select a thread to preview the details.</p>
            </div>
          )}
        </section>
      </div>

      {composeOpen && (
        <div className="compose-modal" onClick={closeCompose} role="dialog">
          <form
            className="compose-dialog"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleComposeSubmit}
          >
            <header className="compose-header">
              <h3>New message</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={closeCompose}
                aria-label="Close compose"
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </header>

            <div className="compose-body">
              <label className="compose-field">
                <span>To</span>
                <input
                  type="email"
                  value={composeForm.to}
                  onChange={(event) =>
                    handleComposeField("to", event.target.value)
                  }
                  required
                  placeholder="recipient@example.com"
                />
              </label>

              <label className="compose-field">
                <span>Subject</span>
                <input
                  type="text"
                  value={composeForm.subject}
                  onChange={(event) =>
                    handleComposeField("subject", event.target.value)
                  }
                  required
                  placeholder="Subject"
                />
              </label>

              <label className="compose-field">
                <span>Message</span>
                <textarea
                  rows={6}
                  value={composeForm.body}
                  onChange={(event) =>
                    handleComposeField("body", event.target.value)
                  }
                  required
                  placeholder="Write your message..."
                />
              </label>
            </div>

            {(composeStatus.error || composeStatus.success) && (
              <p
                className={`compose-status ${
                  composeStatus.error ? "error" : "success"
                }`}
              >
                {composeStatus.error || composeStatus.success}
              </p>
            )}

            <div className="compose-actions">
              <button type="button" className="pill-btn ghost" onClick={closeCompose}>
                Cancel
              </button>
              <button
                type="submit"
                className="pill-btn primary"
                disabled={composeStatus.loading}
              >
                {composeStatus.loading ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default EmailApp;
