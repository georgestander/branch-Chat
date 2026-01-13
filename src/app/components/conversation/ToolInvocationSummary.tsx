"use client";

import { useEffect, useState } from "react";

import type { ToolInvocation } from "@/lib/conversation";
import {
  extractWebSearchResults,
  WEB_SEARCH_TOOL_NAME,
  type WebSearchResultSummary,
} from "@/lib/conversation/tools";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface ToolInvocationSummaryProps {
  toolInvocations?: ToolInvocation[] | null;
  className?: string;
  fallbackHtml?: string;
}

export function ToolInvocationSummary({
  toolInvocations,
  className,
  fallbackHtml,
}: ToolInvocationSummaryProps) {
  if (!toolInvocations || toolInvocations.length === 0) {
    return null;
  }

  const webInvocations = toolInvocations.filter(
    (invocation) => invocation.toolType === WEB_SEARCH_TOOL_NAME,
  );

  if (webInvocations.length === 0) {
    return null;
  }

  const results = extractWebSearchResults(webInvocations);
  const isSearching = webInvocations.some((invocation) =>
    invocation.status === "pending" || invocation.status === "running",
  );
  const hasSucceeded = webInvocations.some(
    (invocation) => invocation.status === "succeeded",
  );
  const failure = webInvocations.find(
    (invocation) => invocation.status === "failed" && invocation.error,
  );

  const [fallbackResults, setFallbackResults] = useState<
    WebSearchResultSummary[]
  >([]);

  useEffect(() => {
    if (!fallbackHtml) {
      setFallbackResults([]);
      return;
    }
    setFallbackResults(extractAnchorsFromHtml(fallbackHtml));
  }, [fallbackHtml]);

  const allResults = results.length > 0 ? results : fallbackResults;
  const externalResults = allResults
    .map((result) => ({
      ...result,
      externalUrl: resolveExternalUrl(result.url),
    }))
    .filter((result) => Boolean(result.externalUrl));

  if (allResults.length === 0) {
    if (failure) {
      return (
        <div
          className={cn(
            "panel-surface panel-edge mt-4 rounded-xl p-4 text-sm text-destructive",
            className,
          )}
        >
          {failure.error?.message ?? "Web search failed."}
        </div>
      );
    }
    if (isSearching) {
      return (
        <div
          className={cn(
            "panel-surface panel-edge mt-4 rounded-xl p-4 text-sm text-muted-foreground",
            className,
          )}
        >
          Searching…
        </div>
      );
    }
    return null;
  }

  if (externalResults.length === 0) {
    return (
      <div
        className={cn(
          "panel-surface panel-edge mt-4 rounded-xl p-4 text-sm text-muted-foreground",
          className,
        )}
      >
        No external sources available yet.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "panel-surface panel-edge mt-4 rounded-xl p-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Web Results
        </span>
        {isSearching && (
          <span className="text-xs text-muted-foreground">Searching…</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {externalResults.map((result, index) => {
          const externalUrl = result.externalUrl as string;
          const displayUrl = formatDisplayUrl(externalUrl);
          const displayHost = formatHost(externalUrl);
          return (
            <div
              key={`badge-${result.id}`}
              className="group relative inline-flex"
            >
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={externalUrl}
                className="inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ExternalLink
                  className="h-3.5 w-3.5 text-primary"
                  aria-hidden="true"
                />
                <span className="truncate max-w-[18ch]">{displayHost}</span>
                {result.title ? (
                  <span className="hidden text-muted-foreground sm:inline">
                    — {truncateText(result.title, 28)}
                  </span>
                ) : null}
              </a>

              <div className="pointer-events-none absolute left-0 top-full z-50 mt-3 hidden w-80 rounded-xl border border-foreground/15 bg-popover p-4 text-left shadow-xl transition group-hover:pointer-events-auto group-hover:block group-focus-within:block">
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Source {index + 1}</span>
                  {result.siteName ? (
                    <span className="text-muted-foreground/80">
                      {result.siteName}
                    </span>
                  ) : null}
                </div>
                {result.title ? (
                  <div className="text-sm font-semibold text-foreground">
                    {result.title}
                  </div>
                ) : null}
                {result.snippet ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {result.snippet}
                  </p>
                ) : null}
                <div className="mt-3 text-xs text-primary">{displayUrl}</div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

function resolveExternalUrl(url: string): string | null {
  if (!url) {
    return null;
  }
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const parsed = new URL(url, origin || undefined);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (origin && parsed.origin === origin) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatDisplayUrl(url: string): string {
  if (!url) {
    return "View source";
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/$/, "");
    const combined = path && path !== "/" ? `${hostname}${path}` : hostname;
    return combined.length > 48
      ? `${combined.slice(0, 45)}…`
      : combined || url;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}

function formatHost(url: string): string {
  if (!url) {
    return "source";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncateText(value: string, max: number): string {
  if (!value) {
    return "";
  }
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function extractAnchorsFromHtml(html: string): WebSearchResultSummary[] {
  if (!html || typeof DOMParser === "undefined") {
    return [];
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const anchors = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    const seen = new Set<string>();
    const summaries: WebSearchResultSummary[] = [];
    anchors.forEach((anchor, index) => {
      const rawHref = anchor.getAttribute("href") ?? "";
      const href = resolveExternalUrl(rawHref);
      if (!href || seen.has(href)) {
        return;
      }
      seen.add(href);
      summaries.push({
        id: `fallback-${index}-${href}`,
        title: anchor.textContent?.trim() ?? "",
        url: href,
        snippet: "",
        siteName: formatHost(href),
        publishedAt: null,
      });
    });
    return summaries;
  } catch (error) {
    console.error("extractAnchorsFromHtml failed", error);
    return [];
  }
}
