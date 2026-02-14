import { useState, useEffect } from "react";
import { getTimezoneInfo, type TimezoneInfo } from "@/utils/timezone";

interface Props {
  timezone: string;
  onRemove?: (timezone: string) => void;
}

export function TimezoneRow({ timezone, onRemove }: Props) {
  const [info, setInfo] = useState<TimezoneInfo>(() => getTimezoneInfo(timezone));

  useEffect(() => {
    // Update time every 30 seconds
    const interval = setInterval(() => {
      setInfo(getTimezoneInfo(timezone));
    }, 30_000);
    return () => clearInterval(interval);
  }, [timezone]);

  return (
    <div className="tz-row" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      borderBottom: "1px solid #e0e0e0",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{info.label}</div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {info.abbreviation} ({info.utcOffset})
        </div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {info.currentTime}
      </div>
      {onRemove && (
        <button
          onClick={() => onRemove(timezone)}
          style={{
            marginLeft: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "#999",
          }}
          title="Remove timezone"
        >
          ×
        </button>
      )}
    </div>
  );
}
