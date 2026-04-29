/**
 * Time formatting utilities.
 * DB stores UTC timestamptz — display converts to Asia/Seoul (KST, UTC+9).
 */

/**
 * Format a timestamp as HH:mm:ss in Korea Standard Time.
 * Accepts epoch milliseconds (number) or ISO string (from Supabase rows).
 */
export function formatKstTime(ts: number | string): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul',
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
  });
}
