/**
 * Visual Chart & Progress Bar Utilities
 */

/**
 * Generate a beautifully stylized ASCII progress bar.
 * E.g., ██████░░░░ 60%
 */
export function progressBar(fraction, length = 10) {
  const percent = Math.max(0, Math.min(1, fraction));
  const filledLength = Math.round(percent * length);
  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(length - filledLength);
  return `${filled}${empty}`;
}

/**
 * Create a simple sparkline from a series of numbers.
 * E.g.,  ▂▃▄▅▆▇█
 */
export function sparkline(values) {
  if (!values || values.length === 0) return 'No data';
  const ticks = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return ticks[4].repeat(values.length); // flat line if all values are equal
  }

  return values
    .map(v => {
      const scale = (v - min) / range;
      const index = Math.round(scale * (ticks.length - 1));
      return ticks[index];
    })
    .join('');
}

/**
 * Generate a beautiful full text-based horizontal bar chart.
 * Perfect for showing 24h activity.
 */
export function generateHorizontalBarChart(labels, values, maxLength = 12) {
  const maxVal = Math.max(...values);
  if (maxVal === 0) {
    return labels.map(label => `\`${label}\` ░░░░░░░░░░░░ 0`).join('\n');
  }

  return labels
    .map((label, idx) => {
      const val = values[idx];
      const fraction = val / maxVal;
      const bar = progressBar(fraction, maxLength);
      return `\`${label}\` ${bar} \`${val}\``;
    })
    .join('\n');
}
