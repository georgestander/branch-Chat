import brandLogoUrl from "./assets/branchy-chat-browser-logo.png";

type BrandMarkProps = {
  className?: string;
  size: number;
};

export function BrandMark({
  className = "",
  size,
}: BrandMarkProps): React.JSX.Element {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`brand-mark ${className}`.trim()}
      draggable={false}
      height={size}
      src={brandLogoUrl}
      width={size}
    />
  );
}
