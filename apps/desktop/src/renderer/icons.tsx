import type { SVGProps } from "react";

export type IconName =
  | "archive"
  | "arrow-down"
  | "arrow-up"
  | "branch"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "download"
  | "external"
  | "file"
  | "folder"
  | "image"
  | "info"
  | "logout"
  | "menu"
  | "mic"
  | "moon"
  | "more"
  | "paperclip"
  | "pencil"
  | "plus"
  | "redo"
  | "search"
  | "send"
  | "settings"
  | "sidebar"
  | "spark"
  | "square"
  | "sun"
  | "trash"
  | "unarchive"
  | "user";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

export function Icon({
  name,
  size = 18,
  ...props
}: IconProps): React.JSX.Element {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  let content: React.JSX.Element;
  switch (name) {
    case "archive":
      content = (
        <>
          <path d="M4 7h16M5.5 7l1 12h11l1-12M3.5 4h17v3h-17z" />
          <path d="M10 11h4" />
        </>
      );
      break;
    case "arrow-down":
      content = (
        <>
          <path d="M12 4v16" />
          <path d="m6.5 14.5 5.5 5.5 5.5-5.5" />
        </>
      );
      break;
    case "arrow-up":
      content = (
        <>
          <path d="M12 20V4" />
          <path d="m6.5 9.5 5.5-5.5 5.5 5.5" />
        </>
      );
      break;
    case "branch":
      content = (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 5h3a4 4 0 0 1 4 4v5a4 4 0 0 0 1 2.7M8 5a4 4 0 0 1 4 4v3" />
        </>
      );
      break;
    case "check":
      content = <path d="m5 12.5 4.2 4.2L19 7" />;
      break;
    case "chevron-down":
      content = <path d="m6.5 9 5.5 5.5L17.5 9" />;
      break;
    case "chevron-left":
      content = <path d="m14.5 6-6 6 6 6" />;
      break;
    case "chevron-right":
      content = <path d="m9.5 6 6 6-6 6" />;
      break;
    case "close":
      content = (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </>
      );
      break;
    case "download":
      content = (
        <>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 20h14" />
        </>
      );
      break;
    case "external":
      content = (
        <>
          <path d="M14 4h6v6" />
          <path d="M20 4 11 13" />
          <path d="M18 13v6H5V6h6" />
        </>
      );
      break;
    case "file":
      content = (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h4M9 13h6M9 17h5" />
        </>
      );
      break;
    case "folder":
      content = <path d="M3 6h7l2 2h9v11H3z" />;
      break;
    case "image":
      content = (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="m4 18 5-5 4 4 3-3 4 4" />
        </>
      );
      break;
    case "info":
      content = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      );
      break;
    case "logout":
      content = (
        <>
          <path d="M10 5H5v14h5" />
          <path d="M13 8l4 4-4 4M8 12h9" />
        </>
      );
      break;
    case "menu":
      content = (
        <>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </>
      );
      break;
    case "mic":
      content = (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
        </>
      );
      break;
    case "moon":
      content = <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />;
      break;
    case "more":
      content = (
        <>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      );
      break;
    case "paperclip":
      content = <path d="m9 17 7.7-7.7a3 3 0 0 0-4.2-4.2L4.8 12.8a5 5 0 0 0 7.1 7.1l7-7" />;
      break;
    case "pencil":
      content = (
        <>
          <path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z" />
          <path d="m13.5 7 3.5 3.5" />
        </>
      );
      break;
    case "plus":
      content = <path d="M12 5v14M5 12h14" />;
      break;
    case "redo":
      content = (
        <>
          <path d="M18 8V4l4 4-4 4V8h-6a7 7 0 1 0 6.5 9.5" />
        </>
      );
      break;
    case "search":
      content = (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 5 5" />
        </>
      );
      break;
    case "send":
      content = (
        <>
          <path d="m4 4 17 8-17 8 4-8z" />
          <path d="M8 12h13" />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21H10v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.6 1.6 0 0 0 .3-1.8A1.6 1.6 0 0 0 3.1 14H3v-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3h4v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
        </>
      );
      break;
    case "sidebar":
      content = (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      );
      break;
    case "spark":
      content = (
        <>
          <path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
          <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" />
        </>
      );
      break;
    case "square":
      content = <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />;
      break;
    case "sun":
      content = (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      );
      break;
    case "trash":
      content = (
        <>
          <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
        </>
      );
      break;
    case "unarchive":
      content = (
        <>
          <path d="M4 7h16M5.5 7l1 12h11l1-12M3.5 4h17v3h-17z" />
          <path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5" />
        </>
      );
      break;
    case "user":
      content = (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      {...common}
      {...props}
    >
      {content}
    </svg>
  );
}
