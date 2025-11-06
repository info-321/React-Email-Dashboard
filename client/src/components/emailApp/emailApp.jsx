import { useState } from "react";
import "./EmailApp.css";

const inboxThreads = [
  {
    sender: "Reddit",
    subject: "Guys look what I found on Play Store",
    snippet: "r/IndiaTech: Guys look what I found on playstore...",
    time: "Nov 4",
  },
  {
    sender: "Travel And Tour World",
    subject: "New Travel Chaos in Canada is here",
    snippet: "The US has officially joined Canada, UK and Carib...",
    time: "Nov 4",
  },
  {
    sender: "Paramita, me",
    subject: "Section news",
    snippet: "The evening newsletter for November 3 is ready.",
    time: "Nov 3",
  },
];

const folderIcons = {
  Inbox: "inbox",
  Sent: "send",
  Drafts: "draft",
  Starred: "star",
  Archive: "archive",
  Spam: "report",
  Deleted: "delete",
};

const EmailApp = ({ mailbox, onBack, isLightMode, onToggleTheme }) => {
  const activeThread = inboxThreads[0];
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
          <div className="search-pill">
            <span className="material-symbols-rounded">search</span>
            <input type="text" placeholder="Search mail" />
          </div>
          <button className="mode-toggle" onClick={onToggleTheme}>
            <span className="material-symbols-rounded">
              {isLightMode ? "dark_mode" : "light_mode"}
            </span>
            {isLightMode ? "Dark" : "Light"}
          </button>
          <button className="pill-btn ghost" onClick={onBack}>
            ← Back
          </button>
        </div>
      </header>

      <div className="gmail-frame">
        <aside
          className={`gmail-sidebar ${sidebarOpen ? "open" : "collapsed"}`}
        >
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <span className="material-symbols-rounded">menu</span>
          </button>

          <button className="pill-btn primary">Compose</button>

          <div className="mailbox-menu">
            {[
              "Inbox",
              "Sent",
              "Drafts",
              "Starred",
              "Archive",
              "Spam",
              "Deleted",
            ].map((item, idx) => (
              <button
                key={item}
                className={`label-item ${idx === 0 ? "active" : ""}`}
              >
                <span className="material-symbols-rounded">
                  {folderIcons[item]}
                </span>
                <span className="label-text">{item}</span>
              </button>
            ))}
          </div>

          <div className="label-menu labels-section">
            <p className="section-title">Labels</p>
            {["Bookings", "TTW", "Personal"].map((label) => (
              <button key={label} className="label-item">
                {label}
              </button>
            ))}
          </div>

          {/* <button className="ghost-back" onClick={onBack}>
            ← Back to dashboard
          </button> */}
        </aside>

        <section className="gmail-list-pane">
          <div className="list-controls">
            <div className="control-icons">
              {[
                "check_box_outline_blank",
                "archive",
                "delete",
                "event",
              ].map((icon) => (
                <button key={icon}>
                  <span className="material-symbols-rounded">{icon}</span>
                </button>
              ))}
            </div>
            <div className="mail-count">
              <span>1-50 of many</span>
              <button>
                <span className="material-symbols-rounded">chevron_left</span>
              </button>
              <button>
                <span className="material-symbols-rounded">chevron_right</span>
              </button>
            </div>
          </div>

          <div className="list-tabs single">
            <button className="active">All Mails</button>
          </div>

          <ul className="gmail-thread-list">
            {inboxThreads.map((thread) => (
              <li
                key={thread.subject}
                className={
                  thread.subject === activeThread.subject ? "active" : ""
                }
              >
                <div>
                  <p className="thread-sender">{thread.sender}</p>
                  <p className="thread-subject">{thread.subject}</p>
                  <p className="thread-snippet">{thread.snippet}</p>
                </div>
                <span className="thread-time">{thread.time}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="gmail-detail-pane">
          <header className="detail-top">
            <div>
              <p className="detail-title">"{activeThread.subject}"</p>
              <small>{activeThread.sender}</small>
            </div>
            <div className="detail-top-actions">
              {["archive", "delete", "mark_email_unread"].map((icon) => (
                <button key={icon} className="icon-btn">
                  <span className="material-symbols-rounded">{icon}</span>
                </button>
              ))}
            </div>
          </header>

          <article className="gmail-message">
            <p className="message-heading">{activeThread.subject}</p>
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed sit amet
              ligula quis magna egestas posuere. Donec iaculis interdum neque, a
              viverra magna sollicitudin vel.
            </p>
            <p>
              Regards,
              <br />
              TTW Team
            </p>
          </article>
        </section>
      </div>
    </section>
  );
};

export default EmailApp;
