import { useState, useEffect } from "react";
import { getSavedTimezones, removeTimezone, addTimezone } from "@/utils/timezone";
import { TimezoneRow } from "@/components/TimezoneRow";
import { TimezonePicker } from "@/components/TimezonePicker";

export function Popup() {
  const [timezones, setTimezones] = useState<string[]>([]);

  useEffect(() => {
    getSavedTimezones().then(setTimezones);
  }, []);

  const handleRemoveTimezone = async (tz: string) => {
    const updated = await removeTimezone(tz);
    setTimezones(updated);
  };

  const handleAddTimezone = async (tz: string) => {
    const updated = await addTimezone(tz);
    setTimezones(updated);
  };

  return (
    <div style={{ width: 360, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        background: "linear-gradient(135deg, #1a73e8, #174ea6)",
        color: "white",
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Multizone GCal</h1>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Timezone scheduling for teams</div>
      </div>

      {/* Timezone list */}
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {timezones.map((tz) => (
          <TimezoneRow key={tz} timezone={tz} onRemove={handleRemoveTimezone} />
        ))}
        <div style={{ padding: "8px 12px" }}>
          <TimezonePicker currentTimezones={timezones} onAdd={handleAddTimezone} />
        </div>
      </div>
    </div>
  );
}
