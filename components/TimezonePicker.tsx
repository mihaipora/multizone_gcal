import { useState, useMemo, useCallback } from "react";
import { COMMON_TIMEZONES, getTimezoneLabel, getUTCOffset, searchTimezones } from "@/utils/timezone";

interface Props {
  currentTimezones: string[];
  onAdd: (timezone: string) => void;
}

export function TimezonePicker({ currentTimezones, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const available = useMemo(() => {
    if (search.trim()) {
      return searchTimezones(search, currentTimezones);
    }
    return COMMON_TIMEZONES.filter((tz) => !currentTimezones.includes(tz));
  }, [search, currentTimezones]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
  }, [close]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          padding: "8px",
          border: "1px dashed #ccc",
          borderRadius: 4,
          background: "none",
          cursor: "pointer",
          fontSize: 13,
          color: "#666",
        }}
      >
        + Add timezone
      </button>
    );
  }

  return (
    <div style={{ padding: "8px 0" }} onKeyDown={handleKeyDown}>
      <input
        type="text"
        placeholder="Search city, country, or timezone..."
        aria-label="Search timezones"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
        style={{
          width: "100%",
          padding: "6px 10px",
          fontSize: 13,
          border: "1px solid #ccc",
          borderRadius: 4,
          boxSizing: "border-box",
          marginBottom: 4,
        }}
      />
      <div style={{ maxHeight: 200, overflowY: "auto" }} role="listbox" aria-label="Timezone results">
        {available.map((tz) => (
          <button
            key={tz}
            role="option"
            onClick={() => {
              onAdd(tz);
              close();
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <strong>{getTimezoneLabel(tz)}</strong>
            <span style={{ color: "#999", marginLeft: 8 }}>{getUTCOffset(tz)}</span>
          </button>
        ))}
        {search.trim() && available.length === 0 && (
          <div style={{ padding: "6px 10px", color: "#999", fontSize: 13 }}>
            No timezones found
          </div>
        )}
      </div>
      <button
        onClick={close}
        style={{
          marginTop: 4,
          padding: "4px 10px",
          fontSize: 12,
          border: "none",
          background: "none",
          cursor: "pointer",
          color: "#999",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
