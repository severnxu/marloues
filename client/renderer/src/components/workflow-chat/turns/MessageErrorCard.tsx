import { AlertTriangle, Wrench } from "lucide-react";
import { WorkflowDetailCopyButton } from "../activity/DetailCopyButton";
import { classifyError, splitErrorPrimary } from "./error-guidance";

export function MessageErrorCard({ message }: { message: string }) {
  const guidance = classifyError(message);
  const primary = splitErrorPrimary(message);

  return (
    <div className="message-error-card" role="alert">
      <WorkflowDetailCopyButton value={message} label="复制错误详情" />
      <div className="message-error-head">
        <AlertTriangle />
        <div>
          <strong>{guidance.title}</strong>
          <span>{guidance.summary}</span>
        </div>
      </div>
      {primary ? <p className="message-error-primary">{primary}</p> : null}
      {guidance.actions.length > 0 ? (
        <div className="message-error-actions">
          <ul>
            {guidance.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {guidance.toolHint ? (
        <p className="message-error-toolhint">
          <Wrench />
          {guidance.toolHint}
        </p>
      ) : null}
    </div>
  );
}
