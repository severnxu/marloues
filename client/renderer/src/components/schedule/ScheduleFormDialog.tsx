import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ScheduleNotificationChannel } from "@shared/types";
import { useScheduleStore } from "@/stores/schedule-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  scheduleViewActions,
  useScheduleViewStore,
} from "@/stores/schedule-view-store";
import { ScheduleDatePicker } from "./ScheduleDatePicker";
import { ScheduleFrequencyFields } from "./ScheduleFrequencyFields";
import { ScheduleTagInput } from "./ScheduleTagInput";
import {
  emptyScheduleForm,
  scheduleFormFromTask,
  scheduleInputFromForm,
  type ScheduleFormState,
} from "./schedule-form-model";
import styles from "./SchedulePage.module.css";

const NOTIFICATION_OPTIONS: Array<{
  value: ScheduleNotificationChannel;
  label: string;
}> = [
  { value: "app", label: "App 内通知" },
  { value: "wecom", label: "企微推送" },
  { value: "feishu", label: "飞书推送" },
];

export function ScheduleFormDialog() {
  const mode = useScheduleViewStore((state) => state.form.mode);
  const sourceId = useScheduleViewStore((state) => state.form.sourceId);
  const tasks = useScheduleStore((state) => state.tasks);
  const create = useScheduleStore((state) => state.create);
  const update = useScheduleStore((state) => state.update);
  const workspaces = useWorkspaceStore((state) => state.settings.workspaces);
  const source = sourceId
    ? (tasks.find((task) => task.id === sourceId) ?? null)
    : null;
  const [form, setForm] = useState<ScheduleFormState>(() =>
    emptyScheduleForm(workspaces[0]?.path ?? ""),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!mode) return;
    setForm(
      source
        ? scheduleFormFromTask(source, false)
        : emptyScheduleForm(workspaces[0]?.path ?? ""),
    );
    setError("");
  }, [mode, source, workspaces]);

  useEffect(() => {
    if (!mode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[aria-expanded="true"]')) return;
      scheduleViewActions.closeForm();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode]);

  if (!mode) return null;
  const isEdit = mode === "edit";
  const title = isEdit ? "编辑定时任务" : "新建定时任务";
  const patchForm = (patch: Partial<ScheduleFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const handleSubmit = async () => {
    const result = scheduleInputFromForm(form);
    if (!result.input) {
      setError(result.error ?? "表单配置无效。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isEdit && source) await update(source.id, result.input);
      else await create(result.input);
      scheduleViewActions.closeForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      onClick={() => scheduleViewActions.closeForm()}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHead}>
          <h2>{title}</h2>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="关闭"
            title="关闭"
            onClick={() => scheduleViewActions.closeForm()}
          >
            <X size={14} />
          </button>
        </header>

        <div className={styles.modalBody}>
          <label className={styles.scheduledFormField}>
            <span>任务名称</span>
            <input
              className={styles.input}
              value={form.name}
              maxLength={120}
              required
              onChange={(event) => patchForm({ name: event.target.value })}
            />
          </label>

          <fieldset className={styles.scheduledFormField}>
            <legend>
              标签 <small>最多 3 个</small>
            </legend>
            <ScheduleTagInput
              key={`${mode}-${sourceId ?? "new"}`}
              value={form.tags}
              onChange={(tags) => patchForm({ tags })}
            />
          </fieldset>

          <label className={styles.scheduledFormField}>
            <span>提示词</span>
            <textarea
              className={styles.textarea}
              value={form.instruction}
              rows={5}
              required
              onChange={(event) =>
                patchForm({ instruction: event.target.value })
              }
            />
          </label>

          <ScheduleFrequencyFields form={form} onPatch={patchForm} />

          {form.frequencyMode !== "once" ? (
            <div className={styles.scheduledEffectiveRange}>
              <span>
                生效时间 <small>非必填，不选立即生效</small>
              </span>
              <ScheduleDatePicker
                mode="range"
                value={{
                  start: form.effectiveStart,
                  end: form.effectiveEnd || undefined,
                }}
                placeholder="选择生效日期"
                ariaLabel="生效日期范围"
                onChange={(value) =>
                  patchForm({
                    effectiveStart: value.start,
                    effectiveEnd: value.end ?? "",
                  })
                }
              />
            </div>
          ) : null}

          <fieldset className={styles.scheduledFormField}>
            <legend>通知渠道</legend>
            <div className={styles.scheduledNotificationOptions}>
              {NOTIFICATION_OPTIONS.map((option) => (
                <label key={option.value} className={styles.scheduledCheck}>
                  <input
                    type="checkbox"
                    checked={form.notificationChannels.includes(option.value)}
                    onChange={(event) =>
                      patchForm({
                        notificationChannels: event.target.checked
                          ? [...form.notificationChannels, option.value]
                          : form.notificationChannels.filter(
                              (item) => item !== option.value,
                            ),
                      })
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {error ? <div className={styles.formError}>{error}</div> : null}
        </div>

        <footer className={styles.modalFoot}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            {saving ? "保存中…" : isEdit ? "保存" : "创建"}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => scheduleViewActions.closeForm()}
          >
            取消
          </button>
        </footer>
      </section>
    </div>
  );
}
