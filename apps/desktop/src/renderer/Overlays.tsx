import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Icon } from "./icons.tsx";

type DialogProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
};

export function Dialog({
  title,
  description,
  children,
  onClose,
}: DialogProps): React.JSX.Element {
  return (
    <div className="overlay overlay--center" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            className="icon-button icon-button--quiet"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

type RenameDialogProps = {
  title: string;
  initialValue: string;
  label: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (value: string) => void;
};

export function RenameDialog({
  title,
  initialValue,
  label,
  busy = false,
  onCancel,
  onSave,
}: RenameDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Dialog title={title} onClose={onCancel}>
      <form
        className="dialog__body"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input
            ref={inputRef}
            value={value}
            maxLength={120}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <div className="dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={busy || !value.trim()}
          >
            {busy ? <span className="spinner" /> : null}
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog title={title} description={description} onClose={onCancel}>
      <div className="dialog__actions dialog__actions--standalone">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <span className="spinner" /> : <Icon name="trash" size={15} />}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

type BranchDraftDialogProps = {
  excerpt: string;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (prompt: string) => void;
};

export function BranchDraftDialog({
  excerpt,
  busy = false,
  onCancel,
  onCreate,
}: BranchDraftDialogProps): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => textareaRef.current?.focus(), []);
  return (
    <Dialog
      title="Start a child branch"
      description="The selected reply becomes the fork point. Your prompt starts a separate path."
      onClose={onCancel}
    >
      <form
        className="dialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim()) onCreate(prompt.trim());
        }}
      >
        <blockquote className="branch-quote">{excerpt}</blockquote>
        <label className="field">
          <span>Where should this branch go?</span>
          <textarea
            ref={textareaRef}
            rows={4}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask a follow-up or take this idea in a new direction…"
          />
        </label>
        <div className="dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={busy || !prompt.trim()}
          >
            {busy ? <span className="spinner" /> : <Icon name="branch" size={15} />}
            Create branch
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export type ToastMessage = {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
};

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.tone}`} key={toast.id}>
          <Icon
            name={toast.tone === "success" ? "check" : "info"}
            size={16}
          />
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
