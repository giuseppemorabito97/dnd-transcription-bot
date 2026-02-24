import { writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";
import {
  chunkTranscript,
  chunkTranscriptByScene,
  CHUNK_SIZE_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_CHUNKS_DEV,
} from "./utils/chunking.js";
import {
  ollamaGenerate,
  OLLAMA_MODEL,
  OLLAMA_URL,
} from "./utils/ollamaClient.js";
import { normalizeTranscript } from "./utils/transcriptFormat.js";
import {
  boundariesFromEndTimes,
  parseTimestampToSeconds,
} from "./utils/sceneAssignment.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

function getMasterLabel(masterUsername) {
  const name = masterUsername || process.env.MASTER_USERNAME;
  return name
    ? `Lo speaker "${name}" è il master (narratore). Le sue battute vanno considerate come voce del master/narratore (descrizioni, scene, NPC, regole), non come un personaggio giocante. Non associare mai questo speaker a un personaggio del party; trattalo sempre come narratore.`
    : "Nella trascrizione c'è un master/narratore (DM): le sue battute sono descrizioni, scene, NPC e regole, non azioni di un personaggio. Trattalo sempre come narratore.";
}

/**
 * Genera un riassunto del testo: se sta in contesto un solo prompt, altrimenti chunk → riassunti parziali → riassunto finale.
 * @param {string} text
 * @param {string} [masterUsername]
 * @returns {Promise<string>}
 */

const getSummaryPrompt = async (text, masterUsername) => {
  try {
    const sum = await ollamaGenerate(
      `Estrai SOLO questi elementi dal segmento. ${masterUsername}
- decisioni del party / piani (“facciamo X”)
- eventi irreversibili (“si apre la porta”, “muore X”, “otteniamo Y”)
- loot/oggetti importanti
- informazioni di trama (NPC, fazioni, minacce) e crea un breve riassunto da queste informazioni

REGOLE OBBLIGATORIE:
- Usa i timestamp per orientarti nel testo.
- IGNORA IL COMBATTIMENTO.
- IGNORA COMPLETAMENTE le problematiche tecniche: microfono, audio, connessione, lag, “non si sente”, “si è disconnesso”, problemi di registrazione/streaming, ritardi, echo, rumori. Non citarle mai nel riassunto.
- PREFERISCI USARE LE LINEE DEL MASTER/NARRATORE.

\n\n${text}\n\nRiassunto:`,
      512,
    );
    return sum;
  } catch (error) {
    console.error("[Ollama] Error generating summary:", error.message);
    return "";
  }
};

const SCENE_INTERVAL_SECONDS = 4 * 60; // 4 minuti per scena

async function generateSummary(text, masterUsername) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const masterLabel = getMasterLabel(masterUsername);

  let maxTimestamp = 0;
  for (const line of trimmed.split("\n")) {
    const timestamp = line.split(" ")[0];
    const sec = parseTimestampToSeconds(timestamp);
    if (!Number.isNaN(sec) && sec > maxTimestamp) maxTimestamp = sec;
  }

  const boundaries = [];
  for (let t = 0; t < maxTimestamp; t += SCENE_INTERVAL_SECONDS) {
    boundaries.push({ start: t, end: t + SCENE_INTERVAL_SECONDS });
  }
  if (boundaries.length === 0 && maxTimestamp > 0) {
    boundaries.push({ start: 0, end: maxTimestamp + 1 });
  }

  console.log(boundaries);

  if (trimmed.length <= MAX_CONTEXT_CHARS) {
    return await getSummaryPrompt(trimmed, masterLabel);
  }

  const { chunks: sceneChunks } = chunkTranscriptByScene(
    trimmed,
    MAX_CONTEXT_CHARS,
    boundaries,
  );

  console.log(sceneChunks.length);
  let chunks = sceneChunks;
  if (chunks.length > MAX_CHUNKS_DEV) {
    chunks = chunks.slice(0, MAX_CHUNKS_DEV);
    console.log(
      `[Ollama] Development: limiting to ${MAX_CHUNKS_DEV} summary chunks`,
    );
  }
  const partialSummaries = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Ollama] Summary chunk ${i + 1}/${chunks.length}...`);

    console.log(chunks[i]);
    const sum = await getSummaryPrompt(chunks[i], masterLabel);

    console.log(sum);
    partialSummaries.push(sum);
  }

  const combined = partialSummaries.join("\n\n");

  return generateFinalSummary(combined, masterUsername);
}

async function generateFinalSummary(summary, masterUsername) {
  const masterLabel = getMasterLabel(masterUsername);
  const prompt = `Leggi questo riassunto. ${masterLabel} Correggi gli errori di trascrizione e rendi il testo più leggibile e coerente in italiano. Agisci pensando -less is more-. Se qualcosa non ti torna, non ti sembra utile a chi lo legge, rimuovila. Elimina qualsiasi riferimento a problemi tecnici (microfono, audio, connessione, lag, disconnessioni, registrazione). Crea un racconto coerente con la trascrizione. Massimo 1800 caratteri.\n\nRIASSUNTO:\n${summary}\n\nRIASSUNTO FINALE:`;
  return ollamaGenerate(prompt, 1024);
}

/**
 * Esegue chunking + embedding + riassunto su un testo già rivisto o grezzo.
 * Se options.sceneBoundaries o options.sceneEndTimes sono forniti, i chunk sono costruiti per scena (s_k <= start < e_k).
 * @param {string} text
 * @param {string} sessionName
 * @param {{ masterUsername?: string, sceneBoundaries?: Array<{ start: number, end: number }>, sceneEndTimes?: number[] }} [options]
 * @returns {Promise<{ summary: string | null }>}
 */
async function chunkEmbedAndSummarize(text, sessionName, options = {}) {
  const { masterUsername, sceneBoundaries, sceneEndTimes } = options;
  const revisedDir = join(PROJECT_ROOT, "transcripts-revised");

  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  const boundaries =
    sceneBoundaries ??
    (sceneEndTimes?.length ? boundariesFromEndTimes(sceneEndTimes) : null);

  let chunks;
  let sceneIds = null;
  if (boundaries?.length) {
    const out = chunkTranscriptByScene(text, CHUNK_SIZE_CHARS, boundaries);
    chunks = out.chunks;
    sceneIds = out.sceneIds;
    console.log(
      `[Ollama] Chunks by scene: ${chunks.length} (sceneIds: ${sceneIds.join(", ")})`,
    );
  } else {
    chunks = chunkTranscript(text, CHUNK_SIZE_CHARS);
  }

  if (chunks.length > MAX_CHUNKS_DEV) {
    chunks = chunks.slice(0, MAX_CHUNKS_DEV);
    if (sceneIds) sceneIds = sceneIds.slice(0, MAX_CHUNKS_DEV);
    console.log(`[Ollama] Development: limiting to ${MAX_CHUNKS_DEV} chunks`);
  }

  console.log(
    `[Ollama] Chunks: ${chunks.length} (max ${CHUNK_SIZE_CHARS} chars)`,
  );

  // const embeddings = await embedChunks(chunks);

  // if (embeddings.length > 0) {
  //   const embedPath = join(revisedDir, `${sessionName}_embeddings.json`);
  //   const payload =
  //     sceneIds != null
  //       ? { chunks, sceneIds, embeddings }
  //       : { chunks, embeddings };
  //   await writeFile(embedPath, JSON.stringify(payload, null, 2), "utf-8");
  //   console.log(`[Ollama] Embeddings saved: ${embedPath}`);
  // }

  console.log("[Ollama] Generating summary...");
  let summary = "";
  try {
    summary = await generateSummary(text, masterUsername);
  } catch (err) {
    console.warn("[Ollama] Summary failed:", err.message);
  }

  return { summary: summary || null };
}

/**
 * Process a transcript with Ollama: revisione, chunking, embedding, riassunto.
 * @param {string} transcriptPath - Path to the original transcript
 * @param {string} sessionName - Name of the session
 * @param {{ masterUsername?: string }} [options]
 * @returns {Promise<{ revisedPath: string | null, summary: string | null }>}
 */
export async function processWithOllama(
  transcriptPath,
  sessionName,
  options = {},
) {
  const { masterUsername, sceneBoundaries, sceneEndTimes } = options;
  const masterLabel = getMasterLabel(masterUsername);

  const revisedDir = join(PROJECT_ROOT, "transcripts-revised");
  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  const revisedPath = join(revisedDir, `${sessionName}_revised.txt`);

  const originalTranscript = await readFile(transcriptPath, "utf-8");
  const chunkOriginalTranscript = chunkTranscript(
    originalTranscript,
    CHUNK_SIZE_CHARS,
  );

  let revisedTranscript = "";

  for (const chunk of chunkOriginalTranscript) {
    const originalChunk = normalizeTranscript(chunk);

    console.log(`[Ollama] Processing chunk with ${OLLAMA_MODEL}...`);

    try {
      const prompt = `Sei un assistente che migliora le trascrizioni audio di sessioni di D&D (Dungeons & Dragons). È una sessione di gioco: il master descrive scene e NPC, i giocatori discutono e decidono.

${masterLabel}

Ecco una trascrizione automatica. Il testo potrebbe contenere errori di riconoscimento vocale, parole incomprensibili, o frasi spezzate.

Il tuo compito è:
1. Correggere errori evidenti di trascrizione (parole storpiate, errori di riconoscimento)
2. Rendere le frasi più leggibili e coerenti in italiano corretto
3. Mantenere il senso originale di quello che è stato detto
4. Se una parte è davvero incomprensibile, segnalala con [incomprensibile]
5. NON inventare contenuti che non sono presenti
6. Rimuovi parole in altre lingue che sono chiaramente errori di riconoscimento
7. NON creare contenuti che non sono presenti nella trascrizione originale
8. Se una parola non è in italiano, rimuovila.

FORMATO OUTPUT RICHIESTO (una riga per intervento):
[timestamp] speaker - linea

Esempio:
[0:13] Speaker1 - Questo è il dungeon che avete fatto finora, dovete scegliere dove proseguire.
[0:21] Speaker2 - Aspetta che controllo la mappa.

TRASCRIZIONE ORIGINALE:
${originalChunk}

Rispondi SOLO con la trascrizione migliorata nel formato richiesto, senza commenti aggiuntivi.`;

      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 4096,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      revisedTranscript += data.response + "\n";
    } catch (error) {
      console.error("[Ollama] Error processing transcript:", error.message);
      revisedTranscript += originalChunk;
    }
  }

  // Chunking + embed + summary sul testo rivisto (con scene boundaries se forniti)
  const { summary } = await chunkEmbedAndSummarize(
    revisedTranscript,
    sessionName,
    { masterUsername, sceneBoundaries, sceneEndTimes },
  );

  // File finale: header + trascrizione + riassunto
  let finalTranscript = `D&D Session Transcript (Revised by Ollama/${OLLAMA_MODEL})\n`;
  finalTranscript += `Original: ${sessionName}\n`;
  finalTranscript += `Revised: ${new Date().toLocaleString()}\n`;
  finalTranscript += `${"=".repeat(50)}\n\n`;
  finalTranscript += revisedTranscript;
  if (summary) {
    finalTranscript += `\n\n${"=".repeat(50)}\n\n## Riassunto\n\n${summary}`;
  }

  await writeFile(revisedPath, finalTranscript, "utf-8");
  console.log(`[Ollama] Revised transcript saved: ${revisedPath}`);

  // Persist master per /summary (sessioni già concluse)
  const metaPath = join(revisedDir, `${sessionName}_meta.json`);
  await writeFile(
    metaPath,
    JSON.stringify({ masterUsername: masterUsername || null }, null, 2),
    "utf-8",
  );

  return { revisedPath, summary };
}

/**
 * Solo summary per una trascrizione esistente (vecchia registrazione).
 * Non rifà la revisione, usa il testo così com'è.
 * @param {string} transcriptPath
 * @param {string} sessionName
 * @param {{ masterUsername?: string }} [options]
 * @returns {Promise<{ summary: string | null, summaryPath: string | null }>}
 */
export async function summarizeTranscriptFile(
  transcriptPath,
  sessionName,
  options = {},
) {
  const revisedDir = join(PROJECT_ROOT, "transcripts-revised");

  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  let masterUsername = options.masterUsername;
  if (masterUsername == null) {
    try {
      const metaPath = join(revisedDir, `${sessionName}_meta.json`);
      if (existsSync(metaPath)) {
        const meta = JSON.parse(await readFile(metaPath, "utf-8"));
        masterUsername = meta.masterUsername || undefined;
      }
    } catch (_) {}
  }

  try {
    const rawText = await readFile(transcriptPath, "utf-8");
    const text = normalizeTranscript(rawText);

    const { summary } = await chunkEmbedAndSummarize(text, sessionName, {
      masterUsername,
      sceneBoundaries: options.sceneBoundaries,
      sceneEndTimes: options.sceneEndTimes,
    });
    if (!summary) {
      return { summary: null, summaryPath: null };
    }

    const summaryPath = join(revisedDir, `${sessionName}_summary.txt`);
    const finalSummary = await generateFinalSummary(summary, masterUsername);

    await writeFile(summaryPath, finalSummary, "utf-8");
    console.log(`[Ollama] Summary file saved: ${summaryPath}`);

    return { summary: finalSummary, summaryPath };
  } catch (error) {
    console.error("[Ollama] Error summarizing transcript:", error.message);
    return { summary: null, summaryPath: null };
  }
}
