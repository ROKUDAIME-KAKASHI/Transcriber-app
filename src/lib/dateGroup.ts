export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier";

/** Bucket a date by local calendar days relative to `now`. */
export function dateGroup(d: Date, now: Date): DateGroup {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  return "Earlier";
}
