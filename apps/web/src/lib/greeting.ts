/**
 * Time-of-day salutation. Uses the browser's local hour so an Indian advocate
 * working at 8 PM IST sees "Good evening" regardless of where the server is.
 *
 *   05:00–11:59 → Good morning
 *   12:00–16:59 → Good afternoon
 *   17:00–21:59 → Good evening
 *   22:00–04:59 → Good night
 */
export function timeOfDaySalutation(now: Date = new Date()): string {
  const h = now.getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

/**
 * Greeting line. Always ends with a period. Falls back to a name-less variant
 * when the first name isn't known yet (avoids "Good evening, .").
 */
export function greetingFor(firstName: string | undefined, now: Date = new Date()): string {
  const salute = timeOfDaySalutation(now);
  const trimmed = (firstName ?? '').trim();
  return trimmed.length > 0 ? `${salute}, ${trimmed}.` : `${salute}.`;
}
