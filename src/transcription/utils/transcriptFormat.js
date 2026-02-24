/**
 * Formato standard: [timestamp] speaker - linea
 * Es: [0:13] Paolo_Fontana - Questo è il dungeon...
 */

const RE_STANDARD = /^\[([^\]]+)\]\s+(\S+)\s+-\s+(.*)$/;
const RE_LEGACY_SPEAKER_FIRST = /^([^\s\[]+)\s+\[([^\]]+)\]\s*:\s*(.*)$/;
const RE_LEGACY_BOLD = /^\*\*([^*]+)\*\*\s*:\s*(.*)$/;

/**
 * Normalizza una singola riga nello standard [timestamp] speaker - linea.
 * @param {string} line
 * @returns {string} riga nel formato [timestamp] speaker - linea
 */
export function normalizeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return "";

  // Già in formato standard
  const standard = trimmed.match(RE_STANDARD);
  if (standard) return trimmed;

  // Speaker [MM:SS]: testo
  const legacy = trimmed.match(RE_LEGACY_SPEAKER_FIRST);
  if (legacy) {
    const [, speaker, timestamp, text] = legacy;
    return `[${timestamp}] ${speaker} - ${text.trim()}`;
  }

  // **Speaker:** testo (senza timestamp)
  const bold = trimmed.match(RE_LEGACY_BOLD);
  if (bold) {
    const [, speaker, text] = bold;
    return `[--:--] ${speaker.trim()} - ${text.trim()}`;
  }

  return trimmed;
}

/**
 * Normalizza un intero testo di trascrizione riga per riga.
 * @param {string} transcript
 * @returns {string}
 */
export function normalizeTranscript(transcript) {
  if (!transcript || !transcript.trim()) return transcript;
  const lines = transcript.split(/\n/);
  const normalized = lines
    .map((l) => normalizeLine(l))
    .filter(Boolean);
  return normalized.join("\n");
}
