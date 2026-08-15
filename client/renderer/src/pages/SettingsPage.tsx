import { SettingsWorkbench, type SettingsSection } from "@/components/settings";

export function SettingsPage({
  section,
  onSection,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
}) {
  return <SettingsWorkbench section={section} onSection={onSection} />;
}
