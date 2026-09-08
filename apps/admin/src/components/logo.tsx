/**
 * The Katha mark.
 *
 * Inline rather than an `<img>` so it inherits the page's colour scheme without a second request, and so the
 * sidebar and the sign-in card cannot drift apart. Geometry is identical to `apps/web/public/logo-mark.svg`,
 * which is the source every raster icon is generated from.
 *
 * Ids are suffixed per instance: two of these on one page with the same gradient id would make the second
 * silently reuse the first one's fill.
 */
export function Logo({
  size = 28,
  className = "",
  label = null,
}: {
  size?: number;
  className?: string;
  /** Null (the default) marks it decorative: every lockup here already sets the name in text beside it. */
  label?: string | null;
}) {
  const id = `katha-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={className}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0" stopColor="#FDC125" />
          <stop offset="1" stopColor="#F0692A" />
        </linearGradient>
        <linearGradient id={`${id}-r`} x1="0" y1="0.35" x2="1" y2="0">
          <stop offset="0" stopColor="#F0692A" />
          <stop offset="1" stopColor="#D40A2C" />
        </linearGradient>
        <mask id={`${id}-play`}>
          <rect width="512" height="512" fill="#fff" />
          <path
            d="M212 172 L212 340 L336 256 Z"
            fill="#000"
            stroke="#000"
            strokeWidth="26"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${id}-play)`}>
        <path
          fill={`url(#${id}-l)`}
          d="M256 128 C256 128 224 96 168 96 L104 96 L104 400 C104 400 152 380 200 400 C232 413 256 416 256 416 Z"
        />
        <path
          fill={`url(#${id}-r)`}
          d="M256 128 C256 128 288 96 344 96 L408 96 L408 400 C408 400 360 380 312 400 C280 413 256 416 256 416 Z"
        />
      </g>
    </svg>
  );
}
