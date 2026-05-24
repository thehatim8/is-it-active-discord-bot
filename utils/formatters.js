/**
 * Text & Time Formatting Utilities
 */

/**
 * Format duration in seconds to a human-readable string.
 * E.g., 3600 -> "1h 00m", 90050 -> "25h 00m 50s", etc.
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  
  const sec = Math.floor(seconds % 60);
  const min = Math.floor((seconds / 60) % 60);
  const hrs = Math.floor(seconds / 3600);

  const parts = [];
  if (hrs > 0) {
    parts.push(`${hrs}h`);
    parts.push(`${String(min).padStart(2, '0')}m`);
  } else if (min > 0) {
    parts.push(`${min}m`);
  } else {
    parts.push(`${sec}s`);
  }

  return parts.join(' ');
}

/**
 * Format a 24-hour integer to an elegant 12-hour AM/PM string.
 * E.g., 0 -> "12:00 AM", 13 -> "01:00 PM"
 */
export function formatHour(hour) {
  const hr = hour % 24;
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const displayHr = hr % 12 === 0 ? 12 : hr % 12;
  return `${String(displayHr).padStart(2, '0')}:00 ${ampm}`;
}

/**
 * Map command-line timeframe option to integer days.
 */
export function timeframeToDays(timeframe) {
  switch (timeframe) {
    case '24h': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case 'all_time':
    default: return 0; // 0 represents "all time" in our SQL functions
  }
}

/**
 * Map command-line timeframe option to clean header labels.
 */
export function formatTimeframeLabel(timeframe) {
  switch (timeframe) {
    case '24h': return 'Last 24 Hours';
    case '7d': return 'Last 7 Days';
    case '30d': return 'Last 30 Days';
    case 'all_time':
    default: return 'All Time';
  }
}
