import { useCallback, type ReactNode, type Ref } from "react";
import type { AuxiliaryViewOption } from "./types";
import { auxiliaryPanelDomId, auxiliaryTabDomId } from "./types";

export function AuxiliaryViewHost({ children }: { children: ReactNode }) {
  return <div className="inspector-body auxiliary-view-host">{children}</div>;
}

export function AuxiliaryViewPanel({
  tabId,
  active,
  children,
}: {
  tabId: string;
  active: boolean;
  children: ReactNode;
}) {
  const setPanelRef = useCallback(
    (node: HTMLElement | null) => {
      if (node) node.inert = !active;
    },
    [active],
  );

  return (
    <section
      ref={setPanelRef}
      id={auxiliaryPanelDomId(tabId)}
      className="auxiliary-view-panel"
      role="tabpanel"
      aria-labelledby={auxiliaryTabDomId(tabId)}
      hidden={!active}
    >
      {children}
    </section>
  );
}

export function AuxiliaryEmptyLauncher({
  options,
  firstActionRef,
  onOpenView,
}: {
  options: readonly AuxiliaryViewOption[];
  firstActionRef?: Ref<HTMLButtonElement>;
  onOpenView: (type: AuxiliaryViewOption["type"]) => void;
}) {
  return (
    <div className="inspector-empty auxiliary-empty-launcher">
      <nav className="inspector-empty-cards" aria-label="选择辅助视图">
        {options.map((option, index) => {
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              ref={index === 0 ? firstActionRef : undefined}
              className="inspector-empty-card"
              type="button"
              onClick={() => onOpenView(option.type)}
            >
              <Icon size={16} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
