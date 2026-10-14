/**
 * Small formatting helpers shared by API routes and client components.
 * Everything here is pure and runtime-agnostic (server and browser).
 */

/** "Olivia Carter" -> "OC" — the avatar/attendee initials used everywhere. */
export function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The human-readable schedule labels stored on a meeting.
 *
 * These are a convenience snapshot ("Fri, Aug 22" / "10:30 AM") — clients that
 * care about the viewer's timezone should format `dateTime` themselves, which
 * is why the dashboard recomputes its own labels from the ISO date.
 */
export function meetingDateLabels(date: Date) {
  return {
    dateLabel: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    timeLabel: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

/** 120 -> "2 hours", 90 -> "90 minutes": a meeting time limit for display. */
export function formatTimeLimit(minutes: number) {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
