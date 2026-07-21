import { useEffect, useMemo, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { ServerRequestEvent } from "../types";

interface Question {
  id: string;
  header?: string;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
}

interface ServerRequestDialogProps {
  request: ServerRequestEvent | null;
  busy: boolean;
  onRespond: (result: unknown) => Promise<void>;
}

export function ServerRequestDialog({ request, busy, onRespond }: ServerRequestDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(Object.create(null));

  useEffect(() => setAnswers(Object.create(null)), [request]);

  const questions = useMemo<Question[]>(() => {
    if (!request || request.method !== "item/tool/requestUserInput") return [];
    return Array.isArray(request.params.questions)
      ? (request.params.questions as Question[])
      : [];
  }, [request]);

  if (!request) return null;
  const isInput = request.method === "item/tool/requestUserInput";
  const isPermissions = request.method === "item/permissions/requestApproval";
  const title = isInput ? "Codex 需要你的回答" : isPermissions ? "Codex 请求额外权限" : "Codex 请求批准";
  const command = String(
    request.params.command ?? request.params.reason ?? request.params.grantRoot ?? "等待你的决定",
  );

  const approve = async () => {
    if (isInput) {
      const mapped = Object.fromEntries(
        questions.map((question) => [question.id, { answers: [answers[question.id] ?? ""] }]),
      );
      await onRespond({ answers: mapped });
      return;
    }
    if (isPermissions) {
      await onRespond({ permissions: request.params.permissions ?? {}, scope: "turn" });
      return;
    }
    await onRespond({ decision: "accept" });
  };

  const decline = async () => {
    if (isInput) {
      const mapped = Object.fromEntries(questions.map((question) => [question.id, { answers: [] }]));
      await onRespond({ answers: mapped });
      return;
    }
    if (isPermissions) {
      await onRespond({ permissions: {}, scope: "turn" });
      return;
    }
    await onRespond({ decision: "decline" });
  };

  return (
    <div className="dialog-backdrop dialog-backdrop--urgent">
      <section className="dialog approval-dialog" role="dialog" aria-modal="true">
        <header className="dialog__header">
          <div className="dialog__title-row">
            <span className="dialog__icon dialog__icon--warning"><ShieldAlert size={19} /></span>
            <div>
              <p className="eyebrow">CODEX APPROVAL</p>
              <h2>{title}</h2>
            </div>
          </div>
        </header>

        {isInput ? (
          <div className="approval-questions">
            {questions.map((question) => (
              <label className="field" key={question.id}>
                <span>{question.header || question.question || question.id}</span>
                {question.options?.length ? (
                  <select
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                  >
                    <option value="">请选择</option>
                    {question.options.map((option) => (
                      <option value={option.label} key={option.label}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                  />
                )}
              </label>
            ))}
          </div>
        ) : (
          <pre className="approval-command">{command}</pre>
        )}

        <footer className="dialog__actions">
          <button className="button button--danger-ghost" type="button" onClick={() => void decline()} disabled={busy}>
            <X size={17} />拒绝
          </button>
          <button className="button button--primary" type="button" onClick={() => void approve()} disabled={busy}>
            <Check size={17} />{busy ? "正在提交" : "批准"}
          </button>
        </footer>
      </section>
    </div>
  );
}

