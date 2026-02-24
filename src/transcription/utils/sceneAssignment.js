/**
 * Assegnazione righe trascrizione alle scene.
 * Regola: scene_k = [s_k, e_k) (end esclusivo). Una riga con start=t va alla scena k se s_k <= t < e_k.
 * Se start cade esattamente su e_k, appartiene alla scena successiva (deterministico).
 */

const RE_STANDARD = /^\[([^\]]+)\]\s+(\S+)\s+-\s+(.*)$/;

/**
 * Converte una stringa timestamp in secondi.
 * Supporta: "0:13", "1:05", "10:21" (M:SS), "1:00:00" (H:MM:SS).
 * @param {string} str - es. "0:13" o "[0:13]" (le parentesi vengono ignorate)
 * @returns {number} secondi, o NaN se non valido
 */
export function parseTimestampToSeconds(str) {
  if (!str || typeof str !== "string") return NaN;
  const cleaned = str.replace(/^\[|\]$/g, "").trim();
  const parts = cleaned.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return NaN;
  if (parts.length === 2) {
    const [min, sec] = parts;
    return min * 60 + sec;
  }
  if (parts.length === 3) {
    const [hour, min, sec] = parts;
    return hour * 3600 + min * 60 + sec;
  }
  return NaN;
}

/**
 * Restituisce l'indice della scena che contiene il tempo t.
 * Confini: scene_k = [s_k, e_k) (end esclusivo). Assegnazione: s_k <= t < e_k.
 * Boundary esatto: se t = e_k, non è in scena k ma in k+1 (coerente).
 * @param {number} tSeconds - tempo in secondi (start della riga)
 * @param {Array<{ start: number, end: number }>} boundaries - confini in secondi, end esclusivo
 * @returns {number} indice scena (0-based), o -1 se fuori da tutti gli intervalli
 */
export function getSceneIndex(tSeconds, boundaries) {
  if (!boundaries?.length || typeof tSeconds !== "number" || isNaN(tSeconds)) {
    return -1;
  }
  for (let k = 0; k < boundaries.length; k++) {
    const { start: s_k, end: e_k } = boundaries[k];
    if (s_k <= tSeconds && tSeconds < e_k) return k;
  }
  return -1;
}

/**
 * Parsing di una riga in formato [timestamp] speaker - linea.
 * @param {string} line - riga normalizzata
 * @returns {{ startSeconds: number, speaker: string, text: string } | null}
 */
export function parseTranscriptLine(line) {
  const trimmed = line?.trim();
  if (!trimmed) return null;
  const m = trimmed.match(RE_STANDARD);
  if (!m) return null;
  const [, timestamp, speaker, text] = m;
  const startSeconds = parseTimestampToSeconds(timestamp);
  if (isNaN(startSeconds)) return null;
  return { startSeconds, speaker, text: text?.trim() ?? "" };
}

/**
 * Assegna una riga (solo start) a una scena. Nessun "end" da creare.
 * @param {number} startSeconds
 * @param {Array<{ start: number, end: number }>} boundaries
 * @returns {{ scene_id: number }}
 */
export function assignLineToScene(startSeconds, boundaries) {
  const scene_id = getSceneIndex(startSeconds, boundaries);
  return { scene_id };
}

/**
 * Opzione A: righe a cavallo (start < scene_end e end > scene_end).
 * Se la riga attraversa il confine, restituisce due record con span_role
 * (stesso speaker e stesso testo in entrambi; primo = full, secondo = continued).
 * Altrimenti un solo record con scene_id (e nessun span_role).
 * @param {number} startSeconds
 * @param {number} endSeconds
 * @param {Array<{ start: number, end: number }>} boundaries
 * @returns {Array<{ scene_id: number, span_role?: 'full' | 'continued' }>}
 */
export function assignLineWithEndToScenes(
  startSeconds,
  endSeconds,
  boundaries,
) {
  const kStart = getSceneIndex(startSeconds, boundaries);
  const kEnd = getSceneIndex(endSeconds, boundaries);
  if (kStart < 0) return [{ scene_id: kEnd < 0 ? 0 : kEnd, span_role: "full" }];
  if (kEnd < 0 || kStart === kEnd) {
    return [{ scene_id: kStart }];
  }
  const out = [];
  for (let k = kStart; k <= kEnd; k++) {
    out.push({
      scene_id: k,
      span_role: k === kStart ? "full" : "continued",
    });
  }
  return out;
}

/**
 * Variante senza split: una sola riga con flag cross_boundary se attraversa più scene.
 * Utile se non vuoi duplicare record (ma in estrazione per scena attenzione a doppio conteggio).
 * @param {number} startSeconds
 * @param {number} endSeconds
 * @param {Array<{ start: number, end: number }>} boundaries
 * @returns {{ scene_id: number, cross_boundary: boolean }}
 */
export function assignLineWithEndNoSplit(startSeconds, endSeconds, boundaries) {
  const kStart = getSceneIndex(startSeconds, boundaries);
  const kEnd = getSceneIndex(endSeconds, boundaries);
  const cross_boundary = kStart >= 0 && kEnd >= 0 && kStart !== kEnd;
  return {
    scene_id: kStart >= 0 ? kStart : kEnd >= 0 ? kEnd : 0,
    cross_boundary,
  };
}

/**
 * Crea boundaries [s_k, e_k) da una lista di end-time in secondi.
 * Es. endTimes = [120, 300, 600] → scene0 [0,120), scene1 [120,300), scene2 [300,600)
 * @param {number[]} endTimesSeconds - fine di ogni scena (esclusiva), ordinate
 * @returns {Array<{ start: number, end: number }>}
 */
export function boundariesFromEndTimes(endTimesSeconds) {
  if (!endTimesSeconds?.length) return [];
  const boundaries = [];
  let start = 0;
  for (const end of endTimesSeconds) {
    boundaries.push({ start, end });
    start = end;
  }
  return boundaries;
}

/**
 * Assegna ogni riga della trascrizione alla scena che contiene il suo start.
 * Formato riga: [timestamp] speaker - linea (come da transcriptFormat).
 * @param {string} transcriptText - trascrizione con una riga per intervento
 * @param {Array<{ start: number, end: number }>} boundaries
 * @returns {Array<{ line: string, scene_id: number, startSeconds: number, speaker: string, text: string }>}
 */
export function assignTranscriptToScenes(transcriptText, boundaries) {
  if (!transcriptText?.trim() || !boundaries?.length) return [];
  const lines = transcriptText.split(/\n/).filter((l) => l.trim());
  const result = [];
  for (const line of lines) {
    const parsed = parseTranscriptLine(line);
    if (!parsed) continue;
    const { scene_id } = assignLineToScene(parsed.startSeconds, boundaries);

    if (scene_id < 0) continue;
    result.push({
      line,
      scene_id,
      startSeconds: parsed.startSeconds,
      speaker: parsed.speaker,
      text: parsed.text,
    });
  }

  console.log(`[Ollama] Assigned ${result.length} lines to scenes`);
  return result;
}
