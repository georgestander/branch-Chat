import { useCallback, useState } from "react";

import { BrandMark } from "./BrandMark.tsx";
import { Icon } from "./icons.tsx";
import type { AccountState } from "./types.ts";

type AccountPanelProps = {
  account: AccountState;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onStartLogin: () => void;
  onCancelLogin: () => void;
  onLogout: () => void;
  onOpenExternal: (url: string) => void;
};

export function AccountPanel({
  account,
  open,
  busy = false,
  onClose,
  onStartLogin,
  onCancelLogin,
  onLogout,
  onOpenExternal,
}: AccountPanelProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(() => {
    const code = account.login?.userCode;
    if (!code) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  }, [account.login?.userCode]);

  if (!open) return null;

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="account-panel"
        aria-label="ChatGPT account"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="account-panel__header">
          <div>
            <span className="eyebrow">Branchy account</span>
            <h2>ChatGPT sign-in</h2>
          </div>
          <button
            className="icon-button icon-button--quiet"
            type="button"
            onClick={onClose}
            aria-label="Close account panel"
          >
            <Icon name="close" />
          </button>
        </header>

        {account.status === "signed_in" ? (
          <div className="account-panel__body">
            <div className="signed-in-card">
              <span className="signed-in-card__avatar">
                {account.email?.slice(0, 1).toUpperCase() ?? (
                  <Icon name="user" />
                )}
              </span>
              <div>
                <strong>{account.email ?? "ChatGPT account"}</strong>
                <span>{account.plan ?? "Connected"}</span>
              </div>
              <span className="signed-in-card__check">
                <Icon name="check" size={15} />
              </span>
            </div>
            <div className="privacy-note">
              <Icon name="info" size={17} />
              <p>
                This sign-in lives in Branchy’s private Codex home. It does not
                read or change the credentials used by the Codex app.
              </p>
            </div>
            <button
              className="secondary-button secondary-button--danger"
              type="button"
              disabled={busy}
              onClick={onLogout}
            >
              <Icon name="logout" size={16} />
              Sign out of Branchy
            </button>
          </div>
        ) : account.status === "signing_in" && account.login ? (
          <div className="account-panel__body">
            <div className="device-login">
              <span className="device-login__step">1</span>
              <div>
                <strong>Open the secure ChatGPT sign-in page</strong>
                <p>Your browser handles the account and password.</p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    onOpenExternal(account.login!.verificationUrl)
                  }
                >
                  Open ChatGPT
                  <Icon name="external" size={15} />
                </button>
              </div>
            </div>
            <div className="device-login">
              <span className="device-login__step">2</span>
              <div>
                <strong>Enter this one-time code</strong>
                <button
                  className="device-code"
                  type="button"
                  onClick={copyCode}
                  title="Copy code"
                >
                  <span>{account.login.userCode}</span>
                  <small>{copied ? "Copied" : "Copy"}</small>
                </button>
              </div>
            </div>
            <div className="waiting-row" role="status">
              <span className="spinner" aria-hidden="true" />
              Waiting for ChatGPT authorization…
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={onCancelLogin}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="account-panel__body">
            <div className="account-intro">
              <BrandMark className="account-intro__mark" size={46} />
              <h3>Use Branchy with your ChatGPT account</h3>
              <p>
                Sign in once to stream replies, create images, search the web,
                and dictate into any branch.
              </p>
            </div>
            <ul className="account-feature-list">
              <li>
                <Icon name="branch" size={16} />
                Every branch keeps its own Codex thread context
              </li>
              <li>
                <Icon name="mic" size={16} />
                Dictation returns editable text before you send
              </li>
              <li>
                <Icon name="image" size={16} />
                Image work stays visible through reloads
              </li>
            </ul>
            {account.error ? (
              <div className="inline-error" role="alert">
                <Icon name="info" size={16} />
                {account.error}
              </div>
            ) : null}
            <button
              className="primary-button primary-button--wide"
              type="button"
              disabled={busy}
              onClick={onStartLogin}
            >
              {busy ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Icon name="user" size={16} />
              )}
              Continue with ChatGPT
            </button>
            <p className="account-panel__fine-print">
              Branchy never asks for or stores your ChatGPT password.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
