/**
 * LRC Parser
 *
 * Single shared parser for timestamped (LRC) lyrics.
 *
 * Every consumer - the renderer display, the menu bar sync loop and the
 * translation pipeline - must parse with this function so that line indices
 * always refer to the same line. Tolerates the timestamp variants LRCLIB
 * returns: 1-2 digit minutes, 2-3 digit fractions, and several timestamps
 * on a single line.
 *
 * Lines with an empty text body are kept: they are real gaps in the song and
 * dropping them would shift every following index.
 */

export interface LyricLine {
  time: number;
  text: string;
}

// Leading run of timestamps, e.g. "[00:12.34]" or "[0:12.345][1:30.00]"
const LEADING_TIMESTAMPS = /^\s*((?:\[\d+:\d+(?:[.:]\d+)?\]\s*)+)(.*)$/;

// A single timestamp: minutes, seconds and optional fraction
const TIMESTAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;

/**
 * Convert a timestamp fraction ("5", "34", "345") into seconds
 */
function fractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0;
  return parseInt(fraction, 10) / 10 ** fraction.length;
}

/**
 * Parse LRC content into time-sorted lyric lines
 */
export function parseLRC(content: string | null | undefined): LyricLine[] {
  if (!content) return [];

  const lines: LyricLine[] = [];

  for (const rawLine of content.split('\n')) {
    const match = rawLine.match(LEADING_TIMESTAMPS);
    if (!match?.[1]) continue;

    const text = (match[2] || '').trim();

    // Reset the sticky regex before reusing it on the next line
    TIMESTAMP.lastIndex = 0;
    let stamp = TIMESTAMP.exec(match[1]);

    while (stamp) {
      const minutes = parseInt(stamp[1] as string, 10);
      const seconds = parseInt(stamp[2] as string, 10);
      const time = minutes * 60 + seconds + fractionToSeconds(stamp[3]);
      lines.push({ time, text });
      stamp = TIMESTAMP.exec(match[1]);
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export default parseLRC;
