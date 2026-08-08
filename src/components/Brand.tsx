import brandIcon from "../assets/vibekarma-icon.png";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <img className="brand__mark" src={brandIcon} alt="" />
      {!compact && (
        <div className="brand__copy">
          <strong>VibeKarma</strong>
          <span>Codex companion</span>
        </div>
      )}
    </div>
  );
}

