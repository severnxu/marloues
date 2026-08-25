import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  FileText,
  MessagesSquare,
  MonitorCog,
  Rocket,
  ServerCog,
  Terminal,
  Wrench,
} from "lucide-react";
import { SettingsWorkbench } from "./SettingsWorkbench";
import type { SettingsSection } from "./types";
import { useSettingsPageStore } from "@/stores/settings-page-store";
import styles from "./SettingsPage.module.css";

interface NavItem {
  id: SettingsSection;
  label: string;
  description?: string;
  Icon: typeof Wrench;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "通用", description: "运行行为与通知", Icon: Wrench },
  {
    id: "personalization",
    label: "个性化",
    description: "回复风格与指令",
    Icon: Bot,
  },
  {
    id: "appearance",
    label: "外观",
    description: "主题和强调色",
    Icon: MonitorCog,
  },
  {
    id: "providers",
    label: "模型",
    description: "端点与模型",
    Icon: ServerCog,
  },
  {
    id: "runtimes",
    label: "运行时",
    description: "Python/Node 下载",
    Icon: Terminal,
  },
  { id: "audit", label: "审计", description: "工具调用", Icon: FileText },
  {
    id: "im-channels",
    label: "IM 渠道",
    description: "企微 / 飞书双向桥接",
    Icon: MessagesSquare,
  },
  {
    id: "im-bots",
    label: "机器人实例",
    description: "空间、用途与权限",
    Icon: Bot,
  },
  { id: "version", label: "更新", description: "版本与热更新", Icon: Rocket },
];

export function SettingsPage() {
  const open = useSettingsPageStore((s) => s.open);
  const requestedSection = useSettingsPageStore((s) => s.section);
  const close = useSettingsPageStore((s) => s.close);
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 受控 section：设置页打开时使用请求的 section，关闭后不保留。
  const normalizeSection = (
    requested: SettingsSection | null | undefined,
  ): SettingsSection => requested ?? "general";
  const [section, setSection] = useState<SettingsSection>(
    normalizeSection(requestedSection),
  );

  const handleCloseSettings = useCallback(() => {
    close();
    const target = restoreFocusRef.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  }, [close]);

  useEffect(() => {
    if (open) setSection(normalizeSection(requestedSection));
  }, [open, requestedSection]);

  useEffect(() => {
    if (!open) return undefined;

    const appRoot = document.documentElement;
    const workbench = document.querySelector<HTMLElement>(".workbench-layout");
    const wasInert = workbench?.inert ?? false;
    const previousAriaHidden = workbench?.getAttribute("aria-hidden");

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    appRoot.classList.add("settings-page-open");
    if (workbench) {
      workbench.inert = true;
      workbench.setAttribute("aria-hidden", "true");
    }
    const frame = window.requestAnimationFrame(() => {
      returnButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      appRoot.classList.remove("settings-page-open");
      if (!workbench) return;
      workbench.inert = wasInert;
      if (previousAriaHidden == null) {
        workbench.removeAttribute("aria-hidden");
      } else {
        workbench.setAttribute("aria-hidden", previousAriaHidden);
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleCloseSettings();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        ["k", "n"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, handleCloseSettings]);

  if (!open) return null;

  const currentItem =
    NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0];

  return (
    <section
      className={styles.surface}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button
            ref={returnButtonRef}
            type="button"
            className={styles.returnButton}
            onClick={handleCloseSettings}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回工作区</span>
          </button>
        </div>

        <nav className={styles.nav} aria-label="设置分组">
          <span className={styles.navCaption}>设置</span>
          <ul className={styles.navList}>
            {NAV_ITEMS.map((item) => {
              const active = item.id === section;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                    onClick={() => setSection(item.id)}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.Icon size={15} className={styles.navIcon} />
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <main className={styles.content}>
        <div className={`${styles.contentScroll} scrollbar-thin`}>
          <header className={styles.contentHeader}>
            <h1>{currentItem.label}</h1>
            {currentItem.description ? <p>{currentItem.description}</p> : null}
          </header>
          <div className={styles.workbench}>
            <SettingsWorkbench section={section} />
          </div>
        </div>
      </main>
    </section>
  );
}
