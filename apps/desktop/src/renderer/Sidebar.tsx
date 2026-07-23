import { useMemo, useState } from "react";

import { Icon } from "./icons.tsx";
import type {
  AccountState,
  DirectoryConversation,
} from "./types.ts";

type SidebarProps = {
  conversations: DirectoryConversation[];
  activeConversationId: string | null;
  account: AccountState;
  collapsed: boolean;
  overlay?: boolean;
  hideToggle?: boolean;
  theme: "light" | "dark";
  busy?: boolean;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onOpenConversation: (conversationId: string) => void;
  onArchiveConversation: (conversationId: string) => void;
  onUnarchiveConversation: (conversationId: string) => void;
  onOpenAccount: () => void;
  onToggleTheme: () => void;
};

function conversationTimestamp(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const elapsed = Date.now() - time;
  const day = 86_400_000;
  if (elapsed < day) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(time);
  }
  if (elapsed < day * 7) {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(time);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(time);
}

export function Sidebar({
  conversations,
  activeConversationId,
  account,
  collapsed,
  overlay = false,
  hideToggle = false,
  theme,
  busy = false,
  onToggleCollapsed,
  onNewConversation,
  onOpenConversation,
  onArchiveConversation,
  onUnarchiveConversation,
  onOpenAccount,
  onToggleTheme,
}: SidebarProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const activeConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          !conversation.archivedAt &&
          (!normalizedQuery ||
            conversation.title.toLowerCase().includes(normalizedQuery) ||
            conversation.preview?.toLowerCase().includes(normalizedQuery)),
      ),
    [conversations, normalizedQuery],
  );
  const archivedConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          Boolean(conversation.archivedAt) &&
          (!normalizedQuery ||
            conversation.title.toLowerCase().includes(normalizedQuery) ||
            conversation.preview?.toLowerCase().includes(normalizedQuery)),
      ),
    [conversations, normalizedQuery],
  );

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" aria-label="Conversations">
        <div className="sidebar__traffic-spacer" />
        <button
          className="icon-button"
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Open sidebar"
          title="Open sidebar"
        >
          <Icon name="sidebar" />
        </button>
        <button
          className="icon-button icon-button--primary"
          type="button"
          onClick={onNewConversation}
          aria-label="New conversation"
          title="New conversation"
          disabled={busy}
        >
          <Icon name="plus" />
        </button>
        <span className="sidebar__spacer" />
        <button
          className="account-avatar"
          type="button"
          onClick={onOpenAccount}
          aria-label="Open ChatGPT account"
          title={account.email ?? "ChatGPT account"}
        >
          {account.email?.slice(0, 1).toUpperCase() ?? (
            <Icon name="user" size={17} />
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`sidebar ${overlay ? "sidebar--overlay" : ""}`}
      aria-label="Conversations"
    >
      <header className="sidebar__header">
        <div className="sidebar__traffic-spacer" />
        <div className="brand">
          <span className="brand__mark">
            <Icon name="branch" size={16} />
          </span>
          <span>Branchy Chat</span>
        </div>
        {!hideToggle ? (
          <button
            className="icon-button icon-button--quiet"
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Close conversation drawer"
            title="Close conversation drawer"
          >
            <Icon name="close" size={17} />
          </button>
        ) : null}
      </header>

      <div className="sidebar__controls">
        <button
          className="new-chat-button"
          type="button"
          onClick={onNewConversation}
          disabled={busy}
        >
          {busy ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Icon name="plus" size={17} />
          )}
          New conversation
          <kbd>⌘N</kbd>
        </button>
        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌘K</kbd>
        </label>
      </div>

      <nav className="conversation-list" aria-label="Conversation history">
        <div className="conversation-list__label">Recent</div>
        {activeConversations.length > 0 ? (
          activeConversations.map((conversation) => (
            <div
              className={`conversation-item ${
                conversation.id === activeConversationId ? "is-active" : ""
              }`}
              key={conversation.id}
            >
              <button
                className="conversation-item__main"
                type="button"
                onClick={() => onOpenConversation(conversation.id)}
              >
                <span className="conversation-item__title">
                  {conversation.title || "Untitled conversation"}
                </span>
                <span className="conversation-item__preview">
                  {conversation.preview ?? "No messages yet"}
                </span>
              </button>
              <span className="conversation-item__time">
                {conversationTimestamp(conversation.updatedAt)}
              </span>
              <button
                className="conversation-item__action"
                type="button"
                onClick={() => onArchiveConversation(conversation.id)}
                aria-label={`Archive ${conversation.title}`}
                title="Archive"
              >
                <Icon name="archive" size={14} />
              </button>
            </div>
          ))
        ) : (
          <p className="conversation-list__empty">
            {normalizedQuery ? "No matching conversations." : "No conversations yet."}
          </p>
        )}

        {archivedConversations.length > 0 || showArchived ? (
          <section className="archived-section">
            <button
              className="archived-section__toggle"
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((current) => !current)}
            >
              <Icon name={showArchived ? "chevron-down" : "chevron-right"} size={14} />
              Archived
              <span>{archivedConversations.length}</span>
            </button>
            {showArchived
              ? archivedConversations.map((conversation) => (
                  <div className="conversation-item" key={conversation.id}>
                    <button
                      className="conversation-item__main"
                      type="button"
                      onClick={() => onOpenConversation(conversation.id)}
                    >
                      <span className="conversation-item__title">
                        {conversation.title}
                      </span>
                      <span className="conversation-item__preview">
                        {conversation.preview ?? "Archived conversation"}
                      </span>
                    </button>
                    <button
                      className="conversation-item__action"
                      type="button"
                      onClick={() => onUnarchiveConversation(conversation.id)}
                      aria-label={`Restore ${conversation.title}`}
                      title="Restore"
                    >
                      <Icon name="unarchive" size={14} />
                    </button>
                  </div>
                ))
              : null}
          </section>
        ) : null}
      </nav>

      <footer className="sidebar__footer">
        <button
          className="account-button"
          type="button"
          onClick={onOpenAccount}
        >
          <span className="account-avatar">
            {account.email?.slice(0, 1).toUpperCase() ?? (
              <Icon name="user" size={17} />
            )}
          </span>
          <span className="account-button__copy">
            <strong>
              {account.status === "signed_in"
                ? account.email ?? "ChatGPT"
                : "Connect ChatGPT"}
            </strong>
            <small>
              {account.status === "signed_in"
                ? account.plan ?? "Signed in"
                : "Required to chat"}
            </small>
          </span>
          <span
            className={`account-status account-status--${account.status}`}
            aria-hidden="true"
          />
        </button>
        <button
          className="icon-button icon-button--quiet"
          type="button"
          onClick={onToggleTheme}
          aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Use ${theme === "dark" ? "light" : "dark"} theme`}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
        </button>
      </footer>
    </aside>
  );
}
