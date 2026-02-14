import { useState, useEffect } from "react";
import {
  getSavedTimezones,
  addTimezone,
  removeTimezone,
} from "@/utils/timezone";
import { TimezoneRow } from "@/components/TimezoneRow";
import { TimezonePicker } from "@/components/TimezonePicker";

export function SidePanel() {
  const [timezones, setTimezones] = useState<string[] | null>(null);

  useEffect(() => {
    getSavedTimezones().then(setTimezones);

    // Sync when storage changes (e.g. from popup)
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === "local" && changes["multizone_timezones"]) {
        setTimezones(changes["multizone_timezones"].newValue ?? []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleAddTz = async (tz: string) => {
    setTimezones(await addTimezone(tz));
  };

  const handleRemoveTz = async (tz: string) => {
    setTimezones(await removeTimezone(tz));
  };

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13 }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        background: "linear-gradient(135deg, #1a73e8, #174ea6)",
        color: "white",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Multizone GCal</h1>
      </div>

      {/* Timezones */}
      <div>
        <div style={{ padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "#555", textTransform: "uppercase" }}>
          Timezones
        </div>
        {timezones === null ? (
          <div style={{ padding: "16px 12px", color: "#999", fontSize: 13, textAlign: "center" }}>
            Loading...
          </div>
        ) : (
          <>
            {timezones.map((tz) => (
              <TimezoneRow key={tz} timezone={tz} onRemove={handleRemoveTz} />
            ))}
            <div style={{ padding: "8px 12px" }}>
              <TimezonePicker currentTimezones={timezones} onAdd={handleAddTz} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
