"use client";

import type { ComponentProps } from "react";

type LandingEventData = Record<string, string | number | boolean | null | undefined>;

interface LandingTrackedLinkProps extends ComponentProps<"a"> {
  eventName: string;
  eventData?: LandingEventData;
}

function traceLandingEvent(eventName: string, eventData?: LandingEventData) {
  if (typeof window === "undefined") {
    return;
  }
  const payload = {
    event: eventName,
    ...eventData,
  };
  console.info(`[TRACE] ${eventName}`, JSON.stringify(payload));
}

export function LandingTrackedLink({
  eventName,
  eventData,
  onClick,
  ...props
}: LandingTrackedLinkProps) {
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        traceLandingEvent(eventName, eventData);
      }}
    />
  );
}
