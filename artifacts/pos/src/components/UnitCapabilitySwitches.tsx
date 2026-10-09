import { useId } from "react";
import { capabilityDependencyMessage, getMissingCapabilityDependencies } from "@workspace/db/unit-capability-policy";
import { Switch } from "@/components/ui/switch";
import { ALL_UNIT_CAPABILITIES, CAPABILITY_LABELS, type UnitCapability } from "@/lib/unitProfiles";

interface UnitCapabilitySwitchesProps {
  capabilities: readonly UnitCapability[];
  allowedCapabilities: readonly UnitCapability[];
  onToggle: (capability: UnitCapability, checked: boolean) => void;
}

export function UnitCapabilitySwitches({ capabilities, allowedCapabilities, onToggle }: UnitCapabilitySwitchesProps) {
  const id = useId();
  const missing = getMissingCapabilityDependencies(capabilities);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ALL_UNIT_CAPABILITIES.map(capability => {
        const dependency = missing.find(item => item.capability === capability);
        const warningId = `${id}-${capability}-dependency`;
        const allowed = allowedCapabilities.includes(capability);
        return (
          <div key={capability} className={`rounded-md border text-sm ${!allowed ? "bg-muted/50 text-muted-foreground" : ""}`}>
            <label className="flex items-center gap-2 px-3 py-2">
              <Switch
                aria-label={CAPABILITY_LABELS[capability]}
                aria-describedby={dependency ? warningId : undefined}
                checked={capabilities.includes(capability)}
                disabled={!allowed}
                onCheckedChange={checked => onToggle(capability, checked)}
              />
              <span className="flex-1">{CAPABILITY_LABELS[capability]}</span>
              {!allowed && (
                <span className="text-[10px] uppercase tracking-wide">
                  {capability === "self_service" ? "Ni implementirano" : "Višji paket"}
                </span>
              )}
            </label>
            {dependency && (
              <p id={warningId} role="status" className="px-3 pb-2 text-xs text-amber-800">
                {capabilityDependencyMessage([dependency])}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
