import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadPreferences, savePreferences } from "@/shared/api/commands";
import type { PlatformId } from "@/shared/types/domain";
import { usePlatformStore } from "../model/usePlatformStore";

const OPTIONS: { value: PlatformId; label: string }[] = [
  { value: "bilibili", label: "Bilibili" },
  { value: "douyu", label: "斗鱼" },
];

export function PlatformSwitch() {
  const currentPlatform = usePlatformStore((s) => s.currentPlatform);
  const setCurrentPlatform = usePlatformStore((s) => s.setCurrentPlatform);

  const onSwitch = async (platform: PlatformId) => {
    setCurrentPlatform(platform);
    try {
      const pref = await loadPreferences();
      await savePreferences({ ...pref, defaultPlatform: platform });
    } catch {
      // ignore preference sync failures
    }
  };

  return (
    <ToggleGroup
      type="single"
      value={currentPlatform}
      onValueChange={(v) => {
        if (v) void onSwitch(v as PlatformId);
      }}
    >
      {OPTIONS.map((opt) => (
        <ToggleGroupItem key={opt.value} value={opt.value} className="text-xs h-7 px-3">
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
