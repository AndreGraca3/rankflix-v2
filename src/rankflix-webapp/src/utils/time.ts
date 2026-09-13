// Formats a minute count into a short human-readable duration, e.g. "3d 4h", "12h 30m", "45m".
// Picks the two most significant units so the string stays short in tight UI spaces.
export function formatWatchTime(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.floor(totalMinutes % 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
