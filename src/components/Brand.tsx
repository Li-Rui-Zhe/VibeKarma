import { BrandMarkIcon } from "./EditorialIcons";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <BrandMarkIcon className="brand__mark" />
      {!compact && (
        <div className="brand__copy">
          <strong>VibeKarma</strong>
          <span>Codex companion</span>
        </div>
      )}
    </div>
  );
}

