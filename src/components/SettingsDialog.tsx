import { useEffect, useState } from "react";
import { Database, Save, Settings2, X } from "lucide-react";
import type { AppSettings } from "../types";

interface SettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  dataDir: string;
  busy: boolean;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void>;
}

export function SettingsDialog({
  open,
  settings,
  dataDir,
  busy,
  onClose,
  onSave,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <div className="dialog__title-row">
            <span className="dialog__icon"><Settings2 size={19} /></span>
            <div>
              <p className="eyebrow">LOCAL RUNTIME</p>
              <h2 id="settings-title">运行设置</h2>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(draft);
          }}
        >
          <label className="field">
            <span>Codex 路径</span>
            <input
              value={draft.codexPath ?? ""}
              onChange={(event) => setDraft({ ...draft, codexPath: event.target.value || null })}
              placeholder="codex"
            />
          </label>

          <label className="field">
            <span>CODEX_HOME</span>
            <input
              value={draft.codexHome ?? ""}
              onChange={(event) => setDraft({ ...draft, codexHome: event.target.value || null })}
              placeholder="自动读取本机配置"
            />
          </label>

          <div className="database-location">
            <Database size={17} />
            <span>
              <small>日记数据库</small>
              <strong title={`${dataDir}\\vibekarma.sqlite3`}>{dataDir}\vibekarma.sqlite3</strong>
            </span>
          </div>

          <footer className="dialog__actions">
            <button className="button button--ghost" type="button" onClick={onClose}>
              取消
            </button>
            <button className="button button--primary" type="submit" disabled={busy}>
              <Save size={17} />
              {busy ? "正在保存" : "保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
