import { ImageIcon, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type ImageGenerationPhase = "generating" | "saving";

interface ImageGenerationStatusProps {
  phase: ImageGenerationPhase;
  className?: string;
}

export function ImageGenerationStatus({
  phase,
  className,
}: ImageGenerationStatusProps) {
  const label = phase === "saving" ? "Finishing your image…" : "Creating your image…";

  return (
    <div
      className={cn(
        "relative mt-3 aspect-square w-full max-w-lg overflow-hidden rounded-xl border border-border bg-muted/35",
        className,
      )}
      role="status"
      aria-label={label}
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/5 via-muted/40 to-primary/10" />
      <div className="absolute -left-1/3 top-0 h-full w-1/2 animate-[pulse_1.8s_ease-in-out_infinite] skew-x-[-18deg] bg-gradient-to-r from-transparent via-background/65 to-transparent" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-background/85">
          <ImageIcon className="h-6 w-6" aria-hidden="true" />
          <LoaderCircle
            className="absolute h-12 w-12 animate-spin text-primary/70"
            aria-hidden="true"
          />
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs">You can keep browsing this canvas.</span>
      </div>
    </div>
  );
}
