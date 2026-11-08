/**
 * Today, in the USER'S timezone, as [start, end) instants.
 *
 * The Edge Function runs in UTC; "today" for a user in Asia/Kolkata starts at
 * 18:30 UTC the day before. Computed from the zone's offset at `now`, which is
 * exact except on a DST-change day, where it can be off by that hour.
 */
export function localDayWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const localAsUtc = Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!, parts["hour"]!, parts["minute"]!, parts["second"]!);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const start = new Date(Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!) - offsetMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
