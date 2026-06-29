import { SettingsWorkbench } from "@/components/settings/SettingsWorkbench";
import type { SettingsSection } from "@/components/layout/types";

export function SettingsPage({
  section,
  onSection,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
}) {
  return <SettingsWorkbench section={section} onSection={onSection} />;
}
