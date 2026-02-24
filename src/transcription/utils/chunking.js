const CHUNK_SIZE_CHARS = parseInt(process.env.OLLAMA_CHUNK_SIZE || "4000", 10);
const MAX_CONTEXT_CHARS = 4000;
const VALUABLE_LINE_CHARS = 80;
const SKIPPABLE_WORDS = [
  "danni",
  "posso",
  "una domanda",
  "tiro salvezza",
  "d4",
  "d6",
  "d8",
  "d10",
  "d12",
  "d20",
  "slot",
  "incantesimi",
  "rest",
  "riposo",
  "ore",
  "AC",
  "scheda",
  "punti vita",
  "armor class",
];
const MAX_CHUNKS_DEV = 99;

/**
 * Spezza il testo in chunk senza tagliare a metà riga (mantiene blocchi speaker).
 * @param {string} text
 * @param {number} maxChunkSize
 * @returns {string[]}
 */
export function chunkTranscript(text, maxChunkSize = CHUNK_SIZE_CHARS) {
  const lines = text.split(/\n/).filter((l) => l.trim());
  const chunks = [];
  let current = [];

  for (const line of lines) {
    if (line.length < VALUABLE_LINE_CHARS) {
      console.log(`[Ollama] Skipping line: ${line.length} chars`);
      continue;
    }

    if (SKIPPABLE_WORDS.some((word) => line.includes(word))) {
      console.log(
        `[Ollama] Skipping line: ${line}: it contains a skippable word`,
      );
      continue;
    }

    console.log(`[Ollama] Line: ${line.length} chars`);

    const candidate = current.length ? current.join("\n") + "\n" + line : line;
    if (candidate.length > maxChunkSize && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  console.log(
    `[Ollama] Chunks Unlimited: ${chunks.length} (max ${maxChunkSize} chars)`,
  );
  return chunks.length ? chunks : [text];
}

export {
  CHUNK_SIZE_CHARS,
  MAX_CONTEXT_CHARS,
  VALUABLE_LINE_CHARS,
  SKIPPABLE_WORDS,
  MAX_CHUNKS_DEV,
};
