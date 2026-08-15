/**
 * 水印 Hook — 登录后挂载用户水印，登出销毁
 *
 * 用 auth-store 的 session 驱动：session 变化时重建水印。
 */

import { useEffect, useRef } from "react";
import { createWatermark, type WatermarkInstance } from "@/lib/watermark";
import { useAuthStore } from "@/stores/auth-store";
import { useThemeStore } from "@/stores/theme-store";

export function useWatermark(): void {
  const session = useAuthStore((state) => state.session);
  const themeMode = useThemeStore((state) => state.mode);
  const isDark = useThemeStore((state) => state.isDark);
  const instanceRef = useRef<WatermarkInstance | null>(null);

  useEffect(() => {
    if (!session) {
      instanceRef.current?.destroy();
      instanceRef.current = null;
      return;
    }
    const userId = session.userId || session.username || "unknown";
    const env = session.env ? `(${session.env})` : "";
    instanceRef.current = createWatermark({
      maskTxt: env ? `${userId} ${env}` : userId,
      addTime: true,
    });
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [isDark, session, themeMode]);
}
