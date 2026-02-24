import { writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const CHUNK_SIZE_CHARS = parseInt(process.env.OLLAMA_CHUNK_SIZE || "2000", 10);
const MAX_CONTEXT_CHARS = 12000; // circa limite contesto per summary in un colpo

/**
 * Spezza il testo in chunk senza tagliare a metà riga (mantiene blocchi speaker).
 * @param {string} text
 * @param {number} maxChunkSize
 * @returns {string[]}
 */
function chunkTranscript(text, maxChunkSize = CHUNK_SIZE_CHARS) {
  const lines = text.split(/\n/).filter((l) => l.trim());
  const chunks = [];
  let current = [];

  for (const line of lines) {
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
  return chunks.length ? chunks : [text];
}

/**
 * Embed dei chunk via Ollama /api/embed.
 * @param {string[]} chunks
 * @returns {Promise<number[][]>} array di vettori (o [] se embed non disponibile)
 */
async function embedChunks(chunks) {
  if (!chunks.length) return [];
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_EMBED_MODEL,
        input: chunks,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[Ollama] Embed skipped: ${res.status} ${res.statusText} (pull ${OLLAMA_EMBED_MODEL}?)`,
      );
      return [];
    }
    const data = await res.json();
    return data.embeddings || [];
  } catch (err) {
    console.warn("[Ollama] Embed error:", err.message);
    return [];
  }
}

/**
 * Chiamata generate verso Ollama (prompt singolo).
 * @param {string} prompt
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
async function ollamaGenerate(prompt, maxTokens = 2048) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Ollama API: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.response || "").trim();
}

/**
 * Genera un riassunto del testo: se sta in contesto un solo prompt, altrimenti chunk → riassunti parziali → riassunto finale.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function generateSummary(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (trimmed.length <= MAX_CONTEXT_CHARS) {
    return ollamaGenerate(
      `Sei un assistente. Riassumi in italiano in modo chiaro e conciso questa trascrizione di una sessione di D&D. Elenca i punti principali (eventi, decisioni, personaggi rilevanti). Non inventare nulla, scrivi per punti principali.\n\nTRASCRIZIONE:\n${trimmed}\n\nRIASSUNTO:`,
      1024,
    );
  }

  const chunks = chunkTranscript(trimmed, Math.floor(MAX_CONTEXT_CHARS / 2));
  const partialSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Ollama] Summary chunk ${i + 1}/${chunks.length}...`);
    const sum = await ollamaGenerate(
      `Riassumi in poche righe in italiano questa parte di trascrizione D&D. Solo fatti e decisioni.\n\n${chunks[i]}\n\nRiassunto:`,
      512,
    );
    partialSummaries.push(sum);
  }
  const combined = partialSummaries.join("\n\n");
  return ollamaGenerate(
    `Unisci questi riassunti parziali di una sessione D&D in un unico riassunto coerente in italiano. Punti principali e decisioni.\n\n${combined}\n\nRiassunto finale:`,
    1024,
  );
}

/**
 * Process a transcript with Ollama: revisione, chunking, embedding, riassunto.
 * @param {string} transcriptPath - Path to the original transcript
 * @param {string} sessionName - Name of the session
 * @returns {Promise<{ revisedPath: string | null, summary: string | null }>}
 */
export async function processWithOllama(transcriptPath, sessionName) {
  const revisedDir = join(PROJECT_ROOT, "transcripts-revised");
  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  const revisedPath = join(revisedDir, `${sessionName}_revised.txt`);

  try {
    const originalTranscript = await readFile(transcriptPath, "utf-8");

    console.log(`[Ollama] Processing transcript with ${OLLAMA_MODEL}...`);

    const prompt = `Sei un assistente che migliora le trascrizioni audio di sessioni di D&D (Dungeons & Dragons).

Ecco una trascrizione automatica di una sessione. Il testo potrebbe contenere errori di riconoscimento vocale, parole incomprensibili, o frasi spezzate.

Il tuo compito è:
1. Correggere errori evidenti di trascrizione (parole storpiate, errori di riconoscimento)
2. Rendere le frasi più leggibili e coerenti in italiano corretto
3. Mantenere il senso originale di quello che è stato detto
4. Se una parte è davvero incomprensibile, segnalala con [incomprensibile]
5. NON inventare contenuti che non sono presenti
6. Rimuovi parole in altre lingue che sono chiaramente errori di riconoscimento
7. NON creare contenuti che non sono presenti nella trascrizione originale

FORMATO OUTPUT RICHIESTO (una riga per ogni intervento):
NomeSpeaker [MM:SS]: testo corretto dell'intervento

Esempio:
Paolo_Fontana [0:13]: Questo è il dungeon che avete fatto finora, dovete scegliere dove proseguire.
Giuseppe_Morabito [0:21]: Aspetta che controllo la mappa.

TRASCRIZIONE ORIGINALE:
${originalTranscript}

Rispondi SOLO con la trascrizione migliorata nel formato richiesto, senza commenti aggiuntivi.`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
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
    const revisedTranscript = data.response;

    // Chunking della trascrizione rivista
    const chunks = chunkTranscript(revisedTranscript, CHUNK_SIZE_CHARS);
    console.log(
      `[Ollama] Chunks: ${chunks.length} (max ${CHUNK_SIZE_CHARS} chars)`,
    );

    // Embed dei chunk (opzionale; se il modello embed non c'è, si salta)
    const embeddings = await embedChunks(chunks);
    if (embeddings.length > 0) {
      const embedPath = join(revisedDir, `${sessionName}_embeddings.json`);
      await writeFile(
        embedPath,
        JSON.stringify({ chunks, embeddings }, null, 2),
        "utf-8",
      );
      console.log(`[Ollama] Embeddings saved: ${embedPath}`);
    }

    // Riassunto
    console.log("[Ollama] Generating summary...");
    let summary = "";
    try {
      summary = await generateSummary(revisedTranscript);
    } catch (err) {
      console.warn("[Ollama] Summary failed:", err.message);
    }

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

    return { revisedPath, summary: summary || null };
  } catch (error) {
    console.error("[Ollama] Error processing transcript:", error.message);
    return { revisedPath: null, summary: null };
  }
}
