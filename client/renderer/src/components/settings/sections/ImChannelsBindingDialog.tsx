import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, RotateCcw, X } from "lucide-react";
import type { ImChannelKind } from "@shared/types";
import { ImChannelIcon } from "./ImChannelIcon";
import styles from "./ImChannelsBindingDialog.module.css";
import { ImQrPreview } from "./ImQrPreview";

const FEISHU_FALLBACK_QR_TTL_SECONDS = 600;
const WECOM_SCAN_WAIT_TIMEOUT_SECONDS = 600;
const WECOM_POLL_INTERVAL_MS = 3000;
const SUCCESS_CLOSE_DELAY_MS = 1300;

type BindingState = "idle" | "saving" | "success";

export interface ImManualBindingInput {
  botId: string;
  secret: string;
  bindMode?: "scan" | "manual";
  operatorOpenId?: string;
  tenantBrand?: string;
}

export function ImChannelsBindingDialog({
  channel,
  onClose,
  onManualSave,
}: {
  channel: ImChannelKind;
  onClose: () => void;
  onManualSave: (input: ImManualBindingInput) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"quick" | "manual">("quick");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [qrRefreshKey, setQrRefreshKey] = useState(0);
  const [qrStatus, setQrStatus] = useState("正在生成二维码");
  const [qrError, setQrError] = useState("");
  const [qrLoading, setQrLoading] = useState(true);
  const [manualBotId, setManualBotId] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [manualError, setManualError] = useState("");
  const [bindingState, setBindingState] = useState<BindingState>("idle");
  const onCloseRef = useRef(onClose);
  const onManualSaveRef = useRef(onManualSave);
  const closeTimerRef = useRef<number>();
  const label = channelLabel(channel);
  const hasKnownExpiry = secondsLeft !== null;
  const isExpired = hasKnownExpiry && secondsLeft <= 0;
  const isBindingSaving = bindingState === "saving";
  const isBindingSuccess = bindingState === "success";
  const manualIdLabel = channel === "wecom" ? "Bot ID" : "App ID";
  const manualSecretLabel = channel === "wecom" ? "Secret" : "App Secret";

  useEffect(() => {
    onCloseRef.current = onClose;
    onManualSaveRef.current = onManualSave;
  }, [onClose, onManualSave]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const showBindingError = useCallback((error: unknown) => {
    setBindingState("idle");
    setQrLoading(false);
    setQrStatus("绑定失败");
    setQrError(error instanceof Error ? error.message : String(error));
  }, []);

  const completeBinding = useCallback(
    async (input: ImManualBindingInput) => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      setBindingState("saving");
      setQrLoading(false);
      setQrError("");
      await onManualSaveRef.current(input);
      setBindingState("success");
      setQrStatus(`${label}机器人已绑定`);
      closeTimerRef.current = window.setTimeout(() => {
        onCloseRef.current();
      }, SUCCESS_CLOSE_DELAY_MS);
    },
    [label],
  );

  const scanHintText = isBindingSuccess
    ? `${label}机器人已绑定，正在返回 IM 渠道页`
    : isBindingSaving
      ? "已扫码，正在保存配置并测试连接"
      : qrLoading
        ? "正在向渠道服务生成二维码"
        : qrError
          ? qrError
          : isExpired
            ? "扫码超时，请重试"
            : `打开${label}，扫描二维码完成机器人创建`;

  const countdownText = isBindingSaving
    ? "已扫码，正在保存配置并测试连接"
    : qrLoading
      ? "二维码生成后将显示有效期"
      : hasKnownExpiry
        ? `${qrStatus} · 二维码 ${secondsLeft} 秒后过期`
        : `${qrStatus} · 有效期以${label}页面为准`;

  const submitButtonText = isBindingSuccess
    ? "已保存"
    : isBindingSaving
      ? "保存中"
      : "保存";

  useEffect(() => {
    setBindingState("idle");
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (
      mode !== "quick" ||
      bindingState !== "idle" ||
      secondsLeft === null ||
      secondsLeft <= 0 ||
      !qrCodeUrl
    )
      return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) =>
        value === null ? null : Math.max(0, value - 1),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bindingState, mode, qrCodeUrl, secondsLeft]);

  useEffect(() => {
    if (mode !== "quick" || !isExpired || !qrCodeUrl || bindingState !== "idle")
      return;
    setQrError("扫码超时，请刷新二维码后重试");
    setQrStatus("二维码已过期");
  }, [bindingState, isExpired, mode, qrCodeUrl]);

  useEffect(() => {
    if (mode !== "quick") return;
    let canceled = false;
    let pollTimer: number | undefined;

    const fail = (error: unknown) => {
      if (canceled) return;
      setBindingState("idle");
      setQrLoading(false);
      setQrCodeUrl("");
      setQrStatus("扫码服务不可用");
      setQrError(error instanceof Error ? error.message : String(error));
    };

    setBindingState("idle");
    setQrLoading(true);
    setQrError("");
    setQrCodeUrl("");
    setQrStatus("正在生成二维码");
    setSecondsLeft(null);

    if (!window.marloues?.im) {
      fail(new Error("当前客户端未暴露 IM 后端接口"));
      return () => {
        canceled = true;
      };
    }

    if (channel === "wecom") {
      const pollWecom = async (
        scode: string,
        deadline: number,
        hasProviderExpiry: boolean,
      ): Promise<void> => {
        if (canceled) return;
        if (Date.now() >= deadline) {
          const message = hasProviderExpiry
            ? "二维码已过期，请刷新后重试"
            : "等待扫码超时，请刷新二维码后重试";
          setQrLoading(false);
          setQrError(message);
          setQrStatus(hasProviderExpiry ? "二维码已过期" : "等待扫码超时");
          return;
        }
        try {
          const result = await window.marloues.im.pollWecomQr(scode);
          if (canceled) return;
          if (result.status === "success" && result.botId && result.secret) {
            setQrStatus("扫码成功，正在保存配置");
            try {
              await completeBinding({
                botId: result.botId,
                secret: result.secret,
                bindMode: "scan",
              });
            } catch (error) {
              showBindingError(error);
            }
            return;
          }
          pollTimer = window.setTimeout(
            () => void pollWecom(scode, deadline, hasProviderExpiry),
            WECOM_POLL_INTERVAL_MS,
          );
        } catch (error) {
          fail(error);
        }
      };

      void window.marloues.im
        .generateWecomQr()
        .then((result) => {
          if (canceled) return;
          const expireIn = normalizeQrTtlSeconds(result.expireIn);
          const pollDeadline =
            Date.now() + (expireIn ?? WECOM_SCAN_WAIT_TIMEOUT_SECONDS) * 1000;
          setQrCodeUrl(result.dataUrl ?? result.authUrl);
          setSecondsLeft(expireIn);
          setQrStatus("等待管理员扫码确认");
          setQrLoading(false);
          pollTimer = window.setTimeout(
            () => void pollWecom(result.scode, pollDeadline, expireIn !== null),
            WECOM_POLL_INTERVAL_MS,
          );
        })
        .catch(fail);

      return () => {
        canceled = true;
        if (pollTimer) window.clearTimeout(pollTimer);
      };
    }

    const removeQrCodeListener = window.marloues.im.onFeishuQrCode(
      (payload) => {
        if (canceled) return;
        const expireIn =
          normalizeQrTtlSeconds(payload.expireIn) ??
          FEISHU_FALLBACK_QR_TTL_SECONDS;
        setQrCodeUrl(payload.dataUrl || payload.url);
        setSecondsLeft(expireIn);
        setQrStatus("等待管理员扫码确认");
        setQrLoading(false);
      },
    );
    const removeStatusListener = window.marloues.im.onFeishuQrStatus(
      (payload) => {
        if (canceled) return;
        const nextStatus = feishuStatusText(payload.status);
        setQrStatus(nextStatus);
        if (nextStatus === "二维码已过期") {
          setSecondsLeft(0);
          setQrError("二维码已过期，请刷新后重试");
        }
      },
    );

    void window.marloues.im
      .registerFeishuApp()
      .then(async (result) => {
        if (canceled || result.canceled) return;
        setQrStatus("扫码成功，正在保存配置");
        try {
          await completeBinding({
            botId: result.appId,
            secret: result.appSecret,
            bindMode: "scan",
            operatorOpenId: result.operatorOpenId,
            tenantBrand: result.tenantBrand,
          });
        } catch (error) {
          showBindingError(error);
        }
      })
      .catch(fail);

    return () => {
      canceled = true;
      removeQrCodeListener();
      removeStatusListener();
      void window.marloues.im.cancelFeishuRegister();
    };
  }, [channel, completeBinding, mode, qrRefreshKey, showBindingError]);

  const refreshQrCode = () => {
    if (isBindingSaving || isBindingSuccess) return;
    setQrRefreshKey((value) => value + 1);
  };

  const submitManualConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBindingSaving || isBindingSuccess) return;
    const botId = manualBotId.trim();
    const secret = manualSecret.trim();
    if (!botId || !secret) {
      setManualError(`请输入 ${manualIdLabel} 和 ${manualSecretLabel}`);
      return;
    }
    try {
      setManualError("");
      await completeBinding({ botId, secret, bindMode: "manual" });
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error));
      setBindingState("idle");
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`配置${label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.channelBadge}>
          <ImChannelIcon channel={channel} size="lg" />
        </div>

        <button
          type="button"
          className={styles.closeButton}
          aria-label="关闭"
          title="关闭"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <header className={styles.header}>
          <h2>配置{label}</h2>
          <p>选择一种方式连接{label}机器人</p>
        </header>

        <div className={styles.modeRow} role="radiogroup" aria-label="绑定方式">
          <label className={styles.modeOption}>
            <input
              type="radio"
              checked={mode === "quick"}
              disabled={isBindingSaving || isBindingSuccess}
              onChange={() => setMode("quick")}
            />
            <span>快捷绑定（推荐）</span>
          </label>
          <label className={styles.modeOption}>
            <input
              type="radio"
              checked={mode === "manual"}
              disabled={isBindingSaving || isBindingSuccess}
              onChange={() => setMode("manual")}
            />
            <span>手动配置</span>
          </label>
        </div>

        {mode === "quick" ? (
          <div className={styles.quickPanel}>
            <div className={styles.qrPanel}>
              {isBindingSuccess ? (
                <div
                  className={styles.successPanel}
                  role="status"
                  aria-live="polite"
                >
                  <CheckCircle2 size={42} />
                  <strong>绑定成功</strong>
                  <span>{label}机器人已保存并通过连接测试</span>
                </div>
              ) : (
                <ImQrPreview
                  qrCodeUrl={qrCodeUrl}
                  expired={Boolean(qrCodeUrl) && isExpired}
                  loading={qrLoading}
                  unavailableMessage={qrError || "正在连接渠道授权服务。"}
                />
              )}
            </div>
            <p className={styles.scanHint} aria-live="polite">
              {scanHintText}
            </p>
            {isBindingSuccess ? null : qrError || isExpired ? (
              <div className={styles.errorPill} role="status">
                <AlertCircle size={14} />
                {qrError || "扫码超时，请重试"}
              </div>
            ) : (
              <p className={styles.countdown} aria-live="polite">
                {countdownText}
              </p>
            )}
          </div>
        ) : (
          <form className={styles.manualForm} onSubmit={submitManualConfig}>
            <label className={styles.field}>
              <span>{manualIdLabel}</span>
              <input
                value={manualBotId}
                placeholder={`请输入 ${manualIdLabel}`}
                disabled={isBindingSaving || isBindingSuccess}
                onChange={(event) => {
                  setManualBotId(event.target.value);
                  setManualError("");
                }}
              />
            </label>
            <label className={styles.field}>
              <span>{manualSecretLabel}</span>
              <input
                type="password"
                value={manualSecret}
                placeholder={`请输入 ${manualSecretLabel}`}
                disabled={isBindingSaving || isBindingSuccess}
                onChange={(event) => {
                  setManualSecret(event.target.value);
                  setManualError("");
                }}
              />
            </label>
            {manualError ? (
              <div className={styles.manualError} role="alert">
                {manualError}
              </div>
            ) : null}
            {isBindingSuccess ? (
              <div className={styles.manualSuccess} role="status">
                已保存并完成连接测试
              </div>
            ) : null}
            <div className={styles.manualActions}>
              <button
                type="button"
                disabled={isBindingSaving || isBindingSuccess}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isBindingSaving || isBindingSuccess}
              >
                {submitButtonText}
              </button>
            </div>
          </form>
        )}

        {mode === "quick" ? (
          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.refreshButton}
              disabled={isBindingSaving || isBindingSuccess}
              onClick={refreshQrCode}
            >
              <RotateCcw size={14} />
              刷新二维码
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function channelLabel(channel: ImChannelKind) {
  return channel === "wecom" ? "企业微信" : "飞书";
}

function normalizeQrTtlSeconds(value: number | undefined): number | null {
  if (!Number.isFinite(value) || value == null || value <= 0) return null;
  return Math.floor(value);
}

function feishuStatusText(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("scan")) return "已扫码，等待确认";
  if (normalized.includes("success")) return "授权成功，正在保存配置";
  if (normalized.includes("expire")) return "二维码已过期";
  return "等待管理员扫码确认";
}
