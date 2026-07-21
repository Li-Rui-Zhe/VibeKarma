import mark from "../assets/vibekarma-mark.svg";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <img className="brand__mark" src={mark} alt="" aria-hidden="true" />
      {!compact && (
        <div className="brand__copy">
          <strong>VibeKarma</strong>
          <span>Codex companion</span>
        </div>
      )}
    </div>
  );
}

