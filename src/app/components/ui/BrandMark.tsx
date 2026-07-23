import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  size: number;
};

export function BrandMark({
  className,
  size,
}: BrandMarkProps): React.JSX.Element {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain dark:invert", className)}
      draggable={false}
      height={size}
      src="/branchy-chat-browser-logo.png"
      width={size}
    />
  );
}
