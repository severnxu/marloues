/**
 * 自建 canvas DOM 水印
 *
 * 用 canvas 绘制文字 → 平铺为 position:fixed 背景
 * → MutationObserver 监听容器防篡改（被删除/修改时重建）。
 *
 * 配置项保持简单稳定，供登录态水印复用。
 */

export interface WatermarkOptions {
  /** 水印文字内容 */
  maskTxt: string;
  /** 单元宽度 */
  width?: number;
  /** 单元高度 */
  height?: number;
  /** 文字透明度 0~1 */
  opacity?: number;
  /** 旋转角度（度） */
  rotate?: number;
  /** 字号 */
  fontSize?: number;
  /** 字体 */
  fontFamily?: string;
  /** 层级 */
  zIndex?: number;
  /** 横向间距 */
  xSpace?: number;
  /** 纵向间距 */
  ySpace?: number;
  /** 是否追加时间 */
  addTime?: boolean;
}

export interface WatermarkInstance {
  destroy: () => void;
}

const CONTAINER_ID = "marloues-watermark-container";

/** 根据当前主题决定水印颜色（深色用白，浅色用黑） */
function resolveColor(opacity: number): string {
  const colorScheme =
    (typeof document !== "undefined" &&
      document.documentElement.dataset.themeScheme) ||
    "light";
  const isDark = colorScheme === "dark";
  return isDark
    ? `rgba(255, 255, 255, ${opacity})`
    : `rgba(0, 0, 0, ${opacity})`;
}

export function createWatermark(options: WatermarkOptions): WatermarkInstance {
  const {
    maskTxt,
    width = 150,
    height = 60,
    opacity = 0.06,
    rotate = -15,
    fontSize = 10,
    fontFamily = "sans-serif",
    zIndex = 9999,
    xSpace = 150,
    ySpace = 60,
    addTime = false,
  } = options;

  if (typeof document === "undefined") {
    return { destroy: () => undefined };
  }

  const timeText = addTime
    ? new Date().toLocaleString("zh-CN", { hour12: false })
    : "";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { destroy: () => undefined };

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = resolveColor(opacity);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (timeText) {
    // 两行：第一行用户信息，第二行时间
    const lineGap = fontSize * 0.85;
    ctx.fillText(maskTxt, 0, -lineGap);
    ctx.fillText(timeText, 0, lineGap);
  } else {
    ctx.fillText(maskTxt, 0, 0);
  }
  ctx.restore();
  const dataUrl = canvas.toDataURL("image/png");

  let container = document.getElementById(
    CONTAINER_ID,
  ) as HTMLDivElement | null;
  if (!container) {
    container = document.createElement("div");
    container.id = CONTAINER_ID;
    document.body.appendChild(container);
  }
  const baseStyle = `position:fixed;inset:0;z-index:${zIndex};pointer-events:none;background-repeat:repeat;background-image:url(${dataUrl});background-size:${xSpace}px ${ySpace}px;`;
  container.style.cssText = baseStyle;

  // MutationObserver 防篡改：被删除/隐藏/改属性时重建
  const restore = (): void => {
    if (!container) return;
    if (!container.parentElement) {
      document.body.appendChild(container);
    }
    container.style.cssText = baseStyle;
    container.style.display = "block";
  };

  const bodyObserver = new MutationObserver(() => {
    const el = document.getElementById(CONTAINER_ID);
    if (!el || el !== container) {
      restore();
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: false });

  const selfObserver = new MutationObserver(() => {
    restore();
  });
  selfObserver.observe(container, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });

  return {
    destroy: () => {
      bodyObserver.disconnect();
      selfObserver.disconnect();
      container?.remove();
    },
  };
}

/** 用户水印快捷方法 */
export function createUserWatermark(
  userId: string,
  additionalInfo?: string,
): WatermarkInstance {
  const content = additionalInfo ? `${userId} ${additionalInfo}` : userId;
  return createWatermark({ maskTxt: content, addTime: false });
}
