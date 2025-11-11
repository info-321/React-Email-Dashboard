import { useEffect, useState, useRef } from "react";
import "./EmailApp.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5001";
const PAGE_SIZE = 25;
const EMOJI_PRESET = ["??", "??", "??", "??", "??", "??", "??", "??", "??", "?", "??"];

const folderDefinitions = [
  { key: "inbox", name: "Inbox", icon: "inbox" },
  { key: "sent", name: "Sent", icon: "send" },
  { key: "drafts", name: "Drafts", icon: "draft" },
  { key: "starred", name: "Starred", icon: "star" },
  { key: "archive", name: "Archive", icon: "inventory_2" },
  { key: "spam", name: "Spam", icon: "report" },
  { key: "deleted", name: "Deleted", icon: "delete" },
];

const folderQueryMap = {
  inbox: "in:inbox",
  sent: "in:sent",
  drafts: "in:drafts",
  starred: "is:starred",
  archive: "in:archive",
  spam: "in:spam",
  deleted: "in:trash",
};

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

const sanitizeHtml = (html = "") =>
  html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");

const formatPlainText = (text = "") =>
  text.replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

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

const filterDefaults = {
  from: "",
  to: "",
  subject: "",
  dateStart: "",
  dateEnd: "",
  folder: "",
  hasAttachment: false,
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterForm, setFilterForm] = useState(filterDefaults);
  const [activeQuery, setActiveQuery] = useState("");
  const [pageToken, setPageToken] = useState(null);
  const [prevPageTokens, setPrevPageTokens] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [resultEstimate, setResultEstimate] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [composeOpen, setComposeOpen] = useState(false);
  const buildComposeDefaults = () => ({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
  });
  const [composeForm, setComposeForm] = useState(buildComposeDefaults);
  const [composeStatus, setComposeStatus] = useState({
    loading: false,
    error: "",
    success: "",
  });
  const fileInputRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

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

  const buildSearchQuery = (text = searchInput) => {
    const tokens = [];
    const trimmedText = (text || "").trim();
    if (trimmedText) tokens.push(trimmedText);
    if (filterForm.from) tokens.push(`from:${filterForm.from}`);
    if (filterForm.to) tokens.push(`to:${filterForm.to}`);
    if (filterForm.subject) tokens.push(`subject:${filterForm.subject}`);
    if (filterForm.dateStart) {
      tokens.push(`after:${Math.floor(new Date(filterForm.dateStart).getTime() / 1000)}`);
    }
    if (filterForm.dateEnd) {
      const endSeconds =
        Math.floor(new Date(filterForm.dateEnd).setHours(23, 59, 59, 999) / 1000);
      tokens.push(`before:${endSeconds}`);
    }
    if (filterForm.hasAttachment) tokens.push("has:attachment");
    if (filterForm.folder && folderQueryMap[filterForm.folder]) {
      tokens.push(folderQueryMap[filterForm.folder]);
    }
    return tokens.join(" ").trim();
  };

  const toggleFilter = () => setFilterOpen((prev) => !prev);

  const handleFilterField = (field, value) => {
    setFilterForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleApplyFilters = () => {
    const query = buildSearchQuery(searchInput);
    setActiveQuery(query);
    setFilterOpen(false);
    resetPagination();
  };

  const handleClearFilters = () => {
    setFilterForm(filterDefaults);
    setSearchInput("");
    setActiveQuery("");
    setFilterOpen(false);
    resetPagination();
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const combined = buildSearchQuery(searchInput);
    setActiveQuery(combined);
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

  const handleThreadSelect = (threadId, checked) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(threadId)) return prev;
        return [...prev, threadId];
      }
      return prev.filter((id) => id !== threadId);
    });
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

  const handleBulkAction = async (action, explicitTargets) => {
    const targets = explicitTargets || availableTargets;
    if (!mailbox || !targets.length) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/mailbox/${encodeURIComponent(
          mailbox
        )}/messages/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: targets, action }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} messages.`);
      }
      if (action === "star" || action === "unstar") {
        const starredValue = action === "star";
        const updateLabels = (labels = []) =>
          starredValue
            ? Array.from(new Set([...labels, "STARRED"]))
            : labels.filter((label) => label !== "STARRED");
        setThreads((prev) =>
          prev.map((thread) =>
            targets.includes(thread.id)
              ? {
                  ...thread,
                  isStarred: starredValue,
                  labelIds: updateLabels(thread.labelIds || []),
                }
              : thread
          )
        );
        setSelectedThread((prev) =>
          prev && targets.includes(prev.id)
            ? {
                ...prev,
                isStarred: starredValue,
                labelIds: updateLabels(prev.labelIds || []),
              }
            : prev
        );
      } else {
        setThreads((prev) =>
          prev.filter((thread) => !targets.includes(thread.id))
        );
        setSelectedIds((prev) => prev.filter((id) => !targets.includes(id)));
        if (targets.includes(selectedThread?.id)) {
          setSelectedThread(null);
        }
      }
    } catch (err) {
      setThreadsError(err.message || "Unable to update messages.");
    }
  };

  const handleToggleStar = (thread, nextState) => {
    handleBulkAction(nextState ? "star" : "unstar", [thread.id]);
  };

  const handleAttachmentSelect = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const readers = files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            const base64 =
              typeof result === "string" ? result.split(",").pop() : "";
            resolve({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              size: file.size,
              data: base64,
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    );

    Promise.all(readers)
      .then((attachments) => {
        setComposeForm((prev) => ({
          ...prev,
          attachments: [...prev.attachments, ...attachments],
        }));
      })
      .finally(() => {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      });
  };

  const handleRemoveAttachment = (index) => {
    setComposeForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, idx) => idx !== index),
    }));
  };

  const handleEmojiSelect = (emoji) => {
    setComposeForm((prev) => ({
      ...prev,
      body: `${prev.body}${emoji}`,
    }));
    setShowEmojiPicker(false);
  };

  const handlePrintDraft = () => {
    if (typeof window === "undefined") return;
    const printWindow = window.open("", "_blank", "width=720,height=820");
    if (!printWindow) return;
    const attachmentsList = composeForm.attachments
      .map(
        (file, idx) =>
          `<li>${idx + 1}. ${file.filename} (${Math.round(file.size / 1024)} KB)</li>`
      )
      .join("");
    printWindow.document.write(`
      <html>
        <head>
          <title>Draft Preview</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
            h2 { margin-bottom: 8px; }
            p { margin: 4px 0; }
            pre { white-space: pre-wrap; padding: 12px; border: 1px solid #ddd; border-radius: 12px; background: #f8f8f8; }
          </style>
        </head>
        <body>
          <h2>${composeForm.subject || "(No subject)"}</h2>
          <p><strong>To:</strong> ${composeForm.to || "—"}</p>
          ${
            composeForm.cc
              ? `<p><strong>CC:</strong> ${composeForm.cc}</p>`
              : ""
          }
          ${
            composeForm.bcc
              ? `<p><strong>BCC:</strong> ${composeForm.bcc}</p>`
              : ""
          }
          <h3>Message</h3>
          <pre>${composeForm.body || ""}</pre>
          ${
            composeForm.attachments.length
              ? `<h4>Attachments</h4><ul>${attachmentsList}</ul>`
              : ""
          }
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleComposeField = (field, value) => {
    setComposeForm((prev) => ({ ...prev, [field]: value }));
    setComposeStatus((prev) => ({ ...prev, error: "", success: "" }));
  };

  const closeCompose = () => {
    setComposeOpen(false);
    setComposeStatus({ loading: false, error: "", success: "" });
    setComposeForm(buildComposeDefaults());
    if (fileInputRef.current) fileInputRef.current.value = "";
    setShowEmojiPicker(false);
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
      setComposeForm(buildComposeDefaults());
      if (fileInputRef.current) fileInputRef.current.value = "";
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
            <div className="thread-left">
              <label
                className="thread-checkbox"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(thread.id)}
                  onChange={(event) =>
                    handleThreadSelect(thread.id, event.target.checked)
                  }
                  aria-label="Select conversation"
                />
                <span className="checkbox-ring" />
              </label>
              <div className="thread-preview">
                <p className="thread-sender">
                  {thread.from || thread.to || "Unknown sender"}
                </p>
                <p className="thread-subject">{thread.subject}</p>
                <p className="thread-snippet">
                  {thread.decodedSnippet || thread.snippet}
                </p>
              </div>
            </div>
              <div className="thread-meta">
                <button
                  type="button"
                  className={`thread-star ${thread.isStarred ? "active" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleStar(thread, !thread.isStarred);
                  }}
                  title={thread.isStarred ? "Unstar" : "Star"}
                >
                <span className="material-symbols-rounded">
                  {thread.isStarred ? "star" : "star_border"}
                </span>
              </button>
              <span className="thread-time">
                {formatTimestamp(thread.date)}
              </span>
            </div>
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
          <div className="search-wrapper">
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
              <button
                type="button"
                className="icon-only"
                onClick={toggleFilter}
                aria-label="Filter options"
                title="Filter options"
              >
                <span className="material-symbols-rounded">tune</span>
              </button>
            </form>
            {filterOpen && (
              <div className="search-filter-panel">
                <div className="filter-grid">
                  <label className="filter-field">
                    <span>From</span>
                    <input
                      type="text"
                      value={filterForm.from}
                      onChange={(event) =>
                        handleFilterField("from", event.target.value)
                      }
                    />
                  </label>
                  <label className="filter-field">
                    <span>To</span>
                    <input
                      type="text"
                      value={filterForm.to}
                      onChange={(event) =>
                        handleFilterField("to", event.target.value)
                      }
                    />
                  </label>
                  <label className="filter-field">
                    <span>Subject</span>
                    <input
                      type="text"
                      value={filterForm.subject}
                      onChange={(event) =>
                        handleFilterField("subject", event.target.value)
                      }
                    />
                  </label>
                  <div className="filter-row dates">
                    <label className="filter-field">
                      <span>Date Start</span>
                      <input
                        type="date"
                        value={filterForm.dateStart}
                        onChange={(event) =>
                          handleFilterField("dateStart", event.target.value)
                        }
                      />
                    </label>
                    <label className="filter-field">
                      <span>Date End</span>
                      <input
                        type="date"
                        value={filterForm.dateEnd}
                        onChange={(event) =>
                          handleFilterField("dateEnd", event.target.value)
                        }
                      />
                    </label>
                  </div>
                  <label className="filter-field">
                    <span>Search</span>
                    <div className="select-wrapper">
                      <select
                        value={filterForm.folder}
                        onChange={(event) =>
                          handleFilterField("folder", event.target.value)
                        }
                      >
                        <option value="">All tabs</option>
                        {folderDefinitions.map((folder) => (
                          <option key={folder.key} value={folder.key}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-rounded">expand_more</span>
                    </div>
                  </label>
                  <label className="has-attachment">
                    <input
                      type="checkbox"
                      checked={filterForm.hasAttachment}
                      onChange={(event) =>
                        handleFilterField("hasAttachment", event.target.checked)
                      }
                    />
                    Has attachment
                  </label>
                </div>
                <div className="filter-actions">
                  <button type="button" onClick={handleClearFilters}>
                    Clear Filter
                  </button>
                  <button
                    type="button"
                    className="pill-btn compact"
                    onClick={handleApplyFilters}
                  >
                    Search
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="topbar-controls">
            <div className="control-group">
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
            <div className="topbar-mail-count">
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
              setComposeForm(buildComposeDefaults());
              setShowEmojiPicker(false);
              if (fileInputRef.current) fileInputRef.current.value = "";
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
            {userLabels.length > 0 && (
              <div className="label-scroll">
                {userLabels.map((label) => (
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
          <div className="list-tabs single">
            <button type="button" className="active folder-pill">
              {activeFolderMeta.key === "inbox"
                ? "All Mails"
                : activeFolderMeta.name}
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
                {selectedThread.bodyHtml ? (
                  <div
                    className="gmail-body"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(selectedThread.bodyHtml),
                    }}
                  />
                ) : (
                  <div
                    className="gmail-body"
                    dangerouslySetInnerHTML={{
                      __html: formatPlainText(
                        selectedThread.bodyPlain ||
                          selectedThread.decodedSnippet ||
                          selectedThread.snippet ||
                          ""
                      ),
                    }}
                  />
                )}
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

              <div className="compose-row">
                <label className="compose-field inline">
                  <span>CC</span>
                  <input
                    type="text"
                    value={composeForm.cc}
                    onChange={(event) =>
                      handleComposeField("cc", event.target.value)
                    }
                    placeholder="cc@example.com"
                  />
                </label>
                <label className="compose-field inline">
                  <span>BCC</span>
                  <input
                    type="text"
                    value={composeForm.bcc}
                    onChange={(event) =>
                      handleComposeField("bcc", event.target.value)
                    }
                    placeholder="bcc@example.com"
                  />
                </label>
              </div>

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
                <div className="compose-tools">
                  <div className="compose-tool-buttons">
                    <button
                      type="button"
                      title="Attach file"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="material-symbols-rounded">attach_file</span>
                    </button>
                    <button
                      type="button"
                      title="Insert emoji"
                      onClick={() => setShowEmojiPicker((prev) => !prev)}
                    >
                      <span className="material-symbols-rounded">mood</span>
                    </button>
                    <button
                      type="button"
                      title="Print draft"
                      onClick={() => handlePrintDraft()}
                    >
                      <span className="material-symbols-rounded">print</span>
                    </button>
                  </div>
                  {showEmojiPicker && (
                    <div className="emoji-picker">
                      {EMOJI_PRESET.map((emoji) => (
                        <button
                          type="button"
                          key={emoji}
                          onClick={() => handleEmojiSelect(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              {composeForm.attachments.length > 0 && (
                <div className="compose-attachments">
                  {composeForm.attachments.map((attachment, index) => (
                    <div className="attachment-pill" key={`${attachment.filename}-${index}`}>
                      <span className="material-symbols-rounded">attach_file</span>
                      <div>
                        <p>{attachment.filename}</p>
                        <small>{Math.round(attachment.size / 1024)} KB</small>
                      </div>
                      <button
                        type="button"
                        aria-label="Remove attachment"
                        onClick={() => handleRemoveAttachment(index)}
                      >
                        <span className="material-symbols-rounded">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <input
              type="file"
              hidden
              ref={fileInputRef}
              onChange={handleAttachmentSelect}
              multiple
            />

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
