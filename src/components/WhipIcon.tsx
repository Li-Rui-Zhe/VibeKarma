export function WhipIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`whip-icon ${className}`} aria-hidden="true">
      <i className="whip-icon__handle" />
      <i className="whip-icon__cord" />
      <i className="whip-icon__tip" />
    </span>
  );
}
