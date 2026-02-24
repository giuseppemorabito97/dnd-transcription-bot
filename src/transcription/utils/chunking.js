import {
  assignTranscriptToScenes,
  boundariesFromEndTimes,
} from "./sceneAssignment.js";

const CHUNK_SIZE_CHARS = parseInt(process.env.OLLAMA_CHUNK_SIZE || "4000", 10);
const MAX_CONTEXT_CHARS = 4000;
const VALUABLE_LINE_CHARS = 40;
const SKIPPABLE_WORDS = [
  // "danni",
  // "posso",
  // "una domanda",
  // "tiro salvezza",
  // "d4",
  // "d6",
  // "d8",
  // "d10",
  // "d12",
  // "d20",
  // "slot",
  // "incantesimi",
  // "rest",
  // "riposo",
  // "ore",
  // "AC",
  // "scheda",
  // "punti vita",
  // "armor class",
];
const MAX_CHUNKS_DEV = 5;

/**
 * Spezza il testo in chunk senza tagliare a metà riga (mantiene blocchi speaker).
 * Per assegnare le righe alle scene (scene_id) e filtrare per scena, usa
 * assignTranscriptToScenes() da ./sceneAssignment.js con boundaries [s_k, e_k).
 * @param {string} text
 * @param {number} maxChunkSize
 * @returns {string[]}
 */
export function chunkTranscript(text, maxChunkSize = CHUNK_SIZE_CHARS) {
  const lines = text.split(/\n/).filter((l) => l.trim());
  const chunks = [];
  let current = [];

  // line [timestamp] speaker - line (frase tra start voice e end voice)

  for (const line of lines) {
    //valuable line chars = 80
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

/**
 * Chunk per scena: assegna ogni riga alla scena [s_k, e_k) che contiene il suo start,
 * poi spezza per scena senza tagliare righe (stessa logica di chunkTranscript).
 * @param {string} text - trascrizione [timestamp] speaker - linea
 * @param {number} maxChunkSize
 * @param {Array<{ start: number, end: number }>} boundaries - confini in secondi, end esclusivo
 * @returns {{ chunks: string[], sceneIds: number[] }}
 */
export function chunkTranscriptByScene(text, maxChunkSize, boundaries) {
  console.log(boundaries);
  if (!boundaries?.length) {
    const chunks = chunkTranscript(text, maxChunkSize);
    return { chunks, sceneIds: chunks.map(() => 0) };
  }
  const assigned = assignTranscriptToScenes(text, boundaries);

  const sceneToLines = new Map();
  console.log(assigned, "assigned");
  for (const { line, scene_id } of assigned) {
    if (!sceneToLines.has(scene_id)) sceneToLines.set(scene_id, []);
    sceneToLines.get(scene_id).push(line);
    console.log(sceneToLines.size, "sceneToLines");
  }
  const chunks = [];
  const sceneIds = [];
  const sortedSceneIds = [...sceneToLines.keys()].sort((a, b) => a - b);
  for (const sceneId of sortedSceneIds) {
    const lines = sceneToLines
      .get(sceneId)
      .filter(
        (line) =>
          line.length >= VALUABLE_LINE_CHARS &&
          !SKIPPABLE_WORDS.some((word) => line.includes(word)),
      );
    if (lines.length > 0) {
      chunks.push(lines.join("\n"));
      sceneIds.push(sceneId);
    }
  }
  return { chunks, sceneIds };
}

export {
  CHUNK_SIZE_CHARS,
  MAX_CONTEXT_CHARS,
  VALUABLE_LINE_CHARS,
  SKIPPABLE_WORDS,
  MAX_CHUNKS_DEV,
};
