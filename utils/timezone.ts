/**
 * Timezone conversion utilities using the built-in Intl API.
 * No external libraries — all processing happens locally.
 */

export interface TimezoneInfo {
  id: string; // IANA timezone ID, e.g. "America/New_York"
  label: string; // Display name, e.g. "New York"
  abbreviation: string; // e.g. "EST"
  utcOffset: string; // e.g. "UTC-5"
  currentTime: string; // formatted current time
}

const STORAGE_KEY = "multizone_timezones";

const DEFAULT_TIMEZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatTimeInZone(
  date: Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  };
  return new Intl.DateTimeFormat("en-US", { ...defaultOptions, ...options }).format(date);
}

export function formatDateTimeInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date);
}

export function getTimezoneAbbreviation(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
}

export function getUTCOffset(timezone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return offset.replace("GMT", "UTC");
}

export function getTimezoneLabel(timezone: string): string {
  // "America/New_York" → "New York"
  const city = timezone.split("/").pop() ?? timezone;
  return city.replace(/_/g, " ");
}

export function getTimezoneInfo(timezone: string, date = new Date()): TimezoneInfo {
  return {
    id: timezone,
    label: getTimezoneLabel(timezone),
    abbreviation: getTimezoneAbbreviation(timezone, date),
    utcOffset: getUTCOffset(timezone, date),
    currentTime: formatTimeInZone(date, timezone),
  };
}

export function convertTime(date: Date, fromZone: string, toZone: string): { from: string; to: string } {
  return {
    from: formatDateTimeInZone(date, fromZone),
    to: formatDateTimeInZone(date, toZone),
  };
}

/**
 * Generate an array of hours for a given day across a timezone.
 * Useful for rendering the timezone grid in the sidepanel.
 */
export function getHoursForDay(
  date: Date,
  timezone: string,
): Array<{ hour: number; label: string; date: Date }> {
  const startOfDay = new Date(
    date.toLocaleString("en-US", { timeZone: timezone }).split(",")[0],
  );
  startOfDay.setHours(0, 0, 0, 0);

  return Array.from({ length: 24 }, (_, hour) => {
    const hourDate = new Date(startOfDay.getTime() + hour * 60 * 60 * 1000);
    return {
      hour,
      label: formatTimeInZone(hourDate, timezone),
      date: hourDate,
    };
  });
}

// ── Saved timezone preferences ──

export async function getSavedTimezones(): Promise<string[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? DEFAULT_TIMEZONES;
}

export async function saveTimezones(timezones: string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: timezones });
}

export async function addTimezone(timezone: string): Promise<string[]> {
  const current = await getSavedTimezones();
  if (current.includes(timezone)) return current;
  const updated = [...current, timezone];
  await saveTimezones(updated);
  return updated;
}

export async function removeTimezone(timezone: string): Promise<string[]> {
  const current = await getSavedTimezones();
  const updated = current.filter((tz) => tz !== timezone);
  await saveTimezones(updated);
  return updated;
}

/**
 * List of common IANA timezones for the "add timezone" picker.
 */
export const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

// ── Full timezone list + search ──

let cachedTimezones: string[] | null = null;

export function getOffsetMinutes(timezone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  // "GMT", "GMT+5:30", "GMT-4" etc.
  if (offset === "GMT" || offset === "UTC") return 0;
  const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

export function getAllTimezones(): string[] {
  if (cachedTimezones) return cachedTimezones;
  const all = Intl.supportedValuesOf("timeZone");
  cachedTimezones = all.sort((a, b) => getOffsetMinutes(a) - getOffsetMinutes(b));
  return cachedTimezones;
}

/**
 * Maps IANA timezone IDs to search aliases: country names, alternative cities,
 * capitals, and common abbreviations.
 */
export const TIMEZONE_ALIASES: Record<string, string[]> = {
  // Pacific
  "Pacific/Honolulu": ["Hawaii", "USA"],
  "Pacific/Pago_Pago": ["American Samoa", "Samoa"],
  "Pacific/Auckland": ["New Zealand", "Wellington", "NZ"],
  "Pacific/Fiji": ["Fiji", "Suva"],
  "Pacific/Guam": ["Guam"],
  "Pacific/Noumea": ["New Caledonia"],
  "Pacific/Tongatapu": ["Tonga"],
  "Pacific/Port_Moresby": ["Papua New Guinea", "PNG"],
  "Pacific/Tarawa": ["Kiribati"],
  "Pacific/Apia": ["Samoa", "Western Samoa"],

  // Americas
  "America/Anchorage": ["Alaska", "USA"],
  "America/Los_Angeles": ["San Francisco", "Seattle", "Pacific Time", "PT", "PST", "PDT", "USA", "West Coast"],
  "America/Denver": ["Mountain Time", "MT", "MST", "MDT", "USA"],
  "America/Phoenix": ["Arizona", "USA"],
  "America/Chicago": ["Central Time", "CT", "CST", "CDT", "Dallas", "Houston", "USA"],
  "America/New_York": ["Eastern Time", "ET", "EST", "EDT", "Boston", "Miami", "Washington DC", "USA", "East Coast"],
  "America/Toronto": ["Canada", "Ontario"],
  "America/Vancouver": ["Canada", "British Columbia", "BC"],
  "America/Winnipeg": ["Canada", "Manitoba"],
  "America/Edmonton": ["Canada", "Alberta", "Calgary"],
  "America/Halifax": ["Canada", "Nova Scotia", "Atlantic Time"],
  "America/St_Johns": ["Canada", "Newfoundland"],
  "America/Mexico_City": ["Mexico", "CDMX"],
  "America/Cancun": ["Mexico"],
  "America/Bogota": ["Colombia"],
  "America/Lima": ["Peru"],
  "America/Santiago": ["Chile"],
  "America/Buenos_Aires": ["Argentina"],
  "America/Sao_Paulo": ["Brazil", "Brasil"],
  "America/Caracas": ["Venezuela"],
  "America/Havana": ["Cuba"],
  "America/Panama": ["Panama"],
  "America/Jamaica": ["Jamaica", "Kingston"],
  "America/Costa_Rica": ["Costa Rica", "San Jose"],
  "America/Guatemala": ["Guatemala"],
  "America/Guayaquil": ["Ecuador"],
  "America/La_Paz": ["Bolivia"],
  "America/Asuncion": ["Paraguay"],
  "America/Montevideo": ["Uruguay"],
  "America/Puerto_Rico": ["Puerto Rico"],
  "America/Santo_Domingo": ["Dominican Republic"],
  "America/Port-au-Prince": ["Haiti"],
  "America/Tegucigalpa": ["Honduras"],
  "America/Managua": ["Nicaragua"],
  "America/El_Salvador": ["El Salvador"],

  // Europe
  "Atlantic/Reykjavik": ["Iceland"],
  "Europe/London": ["UK", "Britain", "England", "United Kingdom", "Great Britain", "GMT", "BST"],
  "Europe/Dublin": ["Ireland"],
  "Europe/Lisbon": ["Portugal"],
  "Europe/Paris": ["France"],
  "Europe/Berlin": ["Germany", "CET", "CEST"],
  "Europe/Madrid": ["Spain"],
  "Europe/Rome": ["Italy", "Milan"],
  "Europe/Amsterdam": ["Netherlands", "Holland"],
  "Europe/Brussels": ["Belgium"],
  "Europe/Zurich": ["Switzerland"],
  "Europe/Vienna": ["Austria"],
  "Europe/Warsaw": ["Poland"],
  "Europe/Prague": ["Czech Republic", "Czechia"],
  "Europe/Budapest": ["Hungary"],
  "Europe/Bucharest": ["Romania"],
  "Europe/Sofia": ["Bulgaria"],
  "Europe/Athens": ["Greece"],
  "Europe/Helsinki": ["Finland"],
  "Europe/Stockholm": ["Sweden"],
  "Europe/Oslo": ["Norway"],
  "Europe/Copenhagen": ["Denmark"],
  "Europe/Tallinn": ["Estonia"],
  "Europe/Riga": ["Latvia"],
  "Europe/Vilnius": ["Lithuania"],
  "Europe/Kiev": ["Ukraine", "Kyiv"],
  "Europe/Moscow": ["Russia", "MSK"],
  "Europe/Istanbul": ["Turkey", "Türkiye"],
  "Europe/Belgrade": ["Serbia"],
  "Europe/Zagreb": ["Croatia"],
  "Europe/Ljubljana": ["Slovenia"],
  "Europe/Sarajevo": ["Bosnia", "Bosnia and Herzegovina"],
  "Europe/Skopje": ["North Macedonia", "Macedonia"],
  "Europe/Tirane": ["Albania"],
  "Europe/Luxembourg": ["Luxembourg"],
  "Europe/Malta": ["Malta"],
  "Europe/Bratislava": ["Slovakia"],
  "Europe/Chisinau": ["Moldova"],
  "Europe/Minsk": ["Belarus"],

  // Africa
  "Africa/Cairo": ["Egypt"],
  "Africa/Lagos": ["Nigeria", "West Africa"],
  "Africa/Nairobi": ["Kenya", "East Africa"],
  "Africa/Johannesburg": ["South Africa", "SAST"],
  "Africa/Casablanca": ["Morocco"],
  "Africa/Accra": ["Ghana"],
  "Africa/Addis_Ababa": ["Ethiopia"],
  "Africa/Dar_es_Salaam": ["Tanzania"],
  "Africa/Kampala": ["Uganda"],
  "Africa/Khartoum": ["Sudan"],
  "Africa/Algiers": ["Algeria"],
  "Africa/Tunis": ["Tunisia"],
  "Africa/Tripoli": ["Libya"],
  "Africa/Maputo": ["Mozambique"],
  "Africa/Lusaka": ["Zambia"],
  "Africa/Harare": ["Zimbabwe"],

  // Middle East / West Asia
  "Asia/Dubai": ["UAE", "United Arab Emirates", "Abu Dhabi", "Gulf"],
  "Asia/Riyadh": ["Saudi Arabia", "KSA"],
  "Asia/Qatar": ["Qatar", "Doha"],
  "Asia/Bahrain": ["Bahrain", "Manama"],
  "Asia/Kuwait": ["Kuwait"],
  "Asia/Muscat": ["Oman"],
  "Asia/Tehran": ["Iran"],
  "Asia/Baghdad": ["Iraq"],
  "Asia/Beirut": ["Lebanon"],
  "Asia/Jerusalem": ["Israel", "Tel Aviv"],
  "Asia/Amman": ["Jordan"],
  "Asia/Damascus": ["Syria"],

  // Central / South / Southeast Asia
  "Asia/Kolkata": ["India", "Mumbai", "Delhi", "Bangalore", "Bengaluru", "Chennai", "Hyderabad", "IST"],
  "Asia/Colombo": ["Sri Lanka"],
  "Asia/Kathmandu": ["Nepal"],
  "Asia/Dhaka": ["Bangladesh"],
  "Asia/Karachi": ["Pakistan"],
  "Asia/Kabul": ["Afghanistan"],
  "Asia/Tashkent": ["Uzbekistan"],
  "Asia/Almaty": ["Kazakhstan"],
  "Asia/Tbilisi": ["Georgia"],
  "Asia/Yerevan": ["Armenia"],
  "Asia/Baku": ["Azerbaijan"],
  "Asia/Bangkok": ["Thailand"],
  "Asia/Ho_Chi_Minh": ["Vietnam", "Saigon", "Ho Chi Minh City", "HCMC"],
  "Asia/Jakarta": ["Indonesia"],
  "Asia/Singapore": ["Singapore", "SGT"],
  "Asia/Kuala_Lumpur": ["Malaysia", "KL"],
  "Asia/Manila": ["Philippines"],
  "Asia/Yangon": ["Myanmar", "Burma", "Rangoon"],

  // East Asia
  "Asia/Shanghai": ["China", "Beijing", "Shenzhen", "Guangzhou", "CST"],
  "Asia/Hong_Kong": ["Hong Kong", "HK"],
  "Asia/Taipei": ["Taiwan"],
  "Asia/Tokyo": ["Japan", "JST"],
  "Asia/Seoul": ["South Korea", "Korea", "KST"],
  "Asia/Ulaanbaatar": ["Mongolia"],

  // Oceania
  "Australia/Sydney": ["Australia", "AEST", "Melbourne", "NSW"],
  "Australia/Melbourne": ["Australia", "Victoria"],
  "Australia/Brisbane": ["Australia", "Queensland"],
  "Australia/Perth": ["Australia", "Western Australia", "AWST"],
  "Australia/Adelaide": ["Australia", "South Australia", "ACST"],
  "Australia/Darwin": ["Australia", "Northern Territory"],
};

/**
 * Search all IANA timezones by ID, city label, aliases, or UTC offset string.
 * Returns up to 50 results sorted by UTC offset, excluding `exclude` list.
 */
export function searchTimezones(query: string, exclude: string[] = []): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const excludeSet = new Set(exclude);
  const all = getAllTimezones();

  const matches = all.filter((tz) => {
    if (excludeSet.has(tz)) return false;
    // Match against IANA ID
    if (tz.toLowerCase().includes(q)) return true;
    // Match against city label
    if (getTimezoneLabel(tz).toLowerCase().includes(q)) return true;
    // Match against aliases
    const aliases = TIMEZONE_ALIASES[tz];
    if (aliases?.some((a) => a.toLowerCase().includes(q))) return true;
    // Match against UTC offset string
    if (getUTCOffset(tz).toLowerCase().includes(q)) return true;
    return false;
  });

  return matches.slice(0, 50);
}
