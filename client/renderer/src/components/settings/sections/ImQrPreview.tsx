import styles from "./ImChannelsBindingDialog.module.css";

export function ImQrPreview({
  qrCodeUrl,
  expired,
  loading,
  unavailableMessage,
}: {
  qrCodeUrl?: string;
  expired: boolean;
  loading?: boolean;
  unavailableMessage?: string;
}) {
  if (!qrCodeUrl) {
    return (
      <div className={styles.qrUnavailable} role="status">
        <strong>{loading ? "二维码生成中" : "二维码暂不可用"}</strong>
        <span>{unavailableMessage ?? "请刷新二维码或切换手动配置。"}</span>
      </div>
    );
  }
  return (
    <div
      className={`${styles.qrCode} ${expired ? styles.qrCodeExpired : ""}`}
      aria-label={expired ? "二维码已超时" : "二维码待生成"}
    >
      {expired ? (
        <strong>扫码超时，请重试</strong>
      ) : (
        <img src={qrCodeUrl} alt="IM 绑定二维码" />
      )}
    </div>
  );
}
