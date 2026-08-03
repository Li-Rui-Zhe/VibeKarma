export function WhipIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`whip-icon ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        className="whip-icon__cord"
        d="M17 42c3-20 15-29 29-25 9 2.6 11.8 10.5 8.4 18-2.6 5.8-8.5 8.5-15.4 6.6"
        pathLength="1"
      />
      <path className="whip-icon__guide" d="M42 46c5.8 1.2 10.6-.2 14-4.2" pathLength="1" />
      <path
        className="whip-icon__arrow"
        d="m51.2 40.5 5.2 1.1-1.5 5"
        fill="none"
        pathLength="1"
      />
      <path
        className="whip-icon__handle"
        d="m8.4 46.8 8.8-8.8 8 8-8.8 8.8c-2 2-5.3 2-7.3-.1l-.8-.8c-2-2-2-5.2.1-7.1Z"
      />
      <path className="whip-icon__grip" d="m11.5 45.1 8.2 8.2M14.5 42.1l8.2 8.2" />
    </svg>
  );
}
