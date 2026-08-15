import { useEffect, useId, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type {
  PermissionDialogRequest,
  PermissionDialogScope,
} from "@shared/types";
import { PermissionFilePreview } from "./PermissionFilePreview";
import { formatPermissionRequest } from "./permission-request-format";

export type PermissionRespondHandler = (
  approved: boolean,
  scope?: PermissionDialogScope,
  reason?: string,
) => void;

export function PermissionRequestPanel({
  request,
  onRespond,
}: {
  request: PermissionDialogRequest;
  onRespond: PermissionRespondHandler;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const resolvingRef = useRef(false);
  const [resolving, setResolving] = useState(false);
  const details = formatPermissionRequest(request);
  const options = request.options ?? {
    allowOnce: true,
    allowSession: false,
    denyWithReason: true,
  };

  useEffect(() => {
    resolvingRef.current = false;
    setResolving(false);
    const frame = window.requestAnimationFrame(() => {
      primaryActionRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [request.id]);

  const respond = (approved: boolean, scope: PermissionDialogScope) => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    onRespond(approved, scope);
  };

  const noAllowAction = !options.allowOnce && !options.allowSession;

  return (
    <section
      className="permission-request-panel"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={resolving}
      aria-live="assertive"
    >
      <div className="permission-request-copy">
        <span className="permission-request-kicker">
          <ShieldCheck size={14} strokeWidth={1.8} aria-hidden="true" />
          权限确认
        </span>
        <h2 id={titleId}>{details.title}</h2>
        {details.summary?.kind === "command" ? (
          <code
            className="permission-command-summary"
            title={details.summary.value}
          >
            {details.summary.value}
          </code>
        ) : null}
        {details.summary?.kind === "file" ? (
          <PermissionFilePreview
            path={details.summary.value}
            diffPatch={details.summary.diffPatch}
          />
        ) : null}
        <p id={descriptionId}>{details.description}</p>
      </div>
      <div className="permission-request-actions">
        <button
          ref={noAllowAction ? primaryActionRef : undefined}
          type="button"
          className="permission-deny"
          disabled={resolving}
          onClick={() => respond(false, "once")}
        >
          拒绝
        </button>
        {options.allowSession ? (
          <button
            ref={!options.allowOnce ? primaryActionRef : undefined}
            type="button"
            className={
              options.allowOnce
                ? "permission-allow-secondary"
                : "permission-allow-primary"
            }
            disabled={resolving}
            onClick={() => respond(true, "session")}
          >
            允许此任务
          </button>
        ) : null}
        {options.allowOnce ? (
          <button
            ref={primaryActionRef}
            type="button"
            className="permission-allow-primary"
            disabled={resolving}
            onClick={() => respond(true, "once")}
          >
            允许一次
          </button>
        ) : null}
      </div>
    </section>
  );
}
