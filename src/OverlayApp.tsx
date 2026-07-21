import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Award } from "lucide-react";
import { WhipIcon } from "./components/WhipIcon";
import type { FeedbackKind, OverlayAction } from "./types";

interface Impact {
  kind: FeedbackKind;
  x: number;
  y: number;
}

export function OverlayApp() {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const finishing = useRef(false);

  useEffect(() => {
    let alive = true;
    let stopListening: () => void = () => undefined;
    void listen<FeedbackKind>("overlay-arm", (event) => {
      if (!alive) return;
      finishing.current = false;
      setImpact(null);
      setKind(event.payload);
    }).then((unlisten) => {
      stopListening = unlisten;
    });

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || finishing.current) return;
      setKind(null);
      void invoke("hide_codex_overlay");
    };
    window.addEventListener("keydown", cancel);
    return () => {
      alive = false;
      stopListening();
      window.removeEventListener("keydown", cancel);
    };
  }, []);

  const strike = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!kind || finishing.current) return;
    finishing.current = true;
    const action: OverlayAction = { kind, x: event.clientX, y: event.clientY };
    setImpact(action);
    window.setTimeout(() => {
      void emit("overlay-action", action).finally(async () => {
        setKind(null);
        setImpact(null);
        await invoke("hide_codex_overlay");
      });
    }, kind === "correction" ? 720 : 820);
  };

  return (
    <div
      className={`desktop-overlay desktop-overlay--${kind ?? "idle"} ${impact ? "has-impact" : ""}`}
      onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
      onPointerDown={strike}
      role="application"
      aria-label={kind === "correction" ? "鞭打 Codex" : "奖励 Codex"}
    >
      {kind && !impact && (
        <div
          className={`tool-cursor tool-cursor--${kind}`}
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden="true"
        >
          {kind === "correction" ? <WhipIcon className="whip-icon--cursor" /> : <Award size={48} />}
        </div>
      )}

      {impact?.kind === "correction" && (
        <div className="whip-impact" style={{ left: impact.x, top: impact.y }} aria-hidden="true">
          <span className="whip-impact__swing" />
          <span className="whip-impact__scar whip-impact__scar--one" />
          <span className="whip-impact__scar whip-impact__scar--two" />
          {Array.from({ length: 7 }, (_, index) => (
            <i key={index} style={{ "--spark": `${index * 51}deg` } as React.CSSProperties} />
          ))}
        </div>
      )}

      {impact?.kind === "reward" && (
        <div className="reward-impact" style={{ left: impact.x, top: impact.y }} aria-hidden="true">
          <div className="reward-impact__stamp"><Award size={34} /><strong>做得好</strong></div>
          {Array.from({ length: 10 }, (_, index) => (
            <i key={index} style={{ "--confetti": `${index * 36}deg` } as React.CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}
