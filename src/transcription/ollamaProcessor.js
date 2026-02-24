import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';

/**
 * Process a transcript with Ollama to make it more readable
 * @param {string} transcriptPath - Path to the original transcript
 * @param {string} sessionName - Name of the session
 * @returns {Promise<string>} Path to the revised transcript
 */
export async function processWithOllama(transcriptPath, sessionName) {
  // Ensure revised transcripts directory exists
  const revisedDir = join(PROJECT_ROOT, 'transcripts-revised');
  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  const revisedPath = join(revisedDir, `${sessionName}_revised.txt`);

  try {
    // Read the original transcript
    const originalTranscript = await readFile(transcriptPath, 'utf-8');

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

FORMATO OUTPUT RICHIESTO (una riga per ogni intervento):
NomeSpeaker [MM:SS]: testo corretto dell'intervento

Esempio:
Paolo_Fontana [0:13]: Questo è il dungeon che avete fatto finora, dovete scegliere dove proseguire.
Giuseppe_Morabito [0:21]: Aspetta che controllo la mappa.

TRASCRIZIONE ORIGINALE:
${originalTranscript}

Rispondi SOLO con la trascrizione migliorata nel formato richiesto, senza commenti aggiuntivi.`;

    // Call Ollama API
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 4096,
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const revisedTranscript = data.response;

    // Add header to revised transcript
    let finalTranscript = `D&D Session Transcript (Revised by Ollama/${OLLAMA_MODEL})\n`;
    finalTranscript += `Original: ${sessionName}\n`;
    finalTranscript += `Revised: ${new Date().toLocaleString()}\n`;
    finalTranscript += `${'='.repeat(50)}\n\n`;
    finalTranscript += revisedTranscript;

    // Save the revised transcript
    await writeFile(revisedPath, finalTranscript, 'utf-8');
    console.log(`[Ollama] Revised transcript saved: ${revisedPath}`);

    return revisedPath;
  } catch (error) {
    console.error('[Ollama] Error processing transcript:', error.message);
    // Return null if processing fails - the original transcript is still available
    return null;
  }
}
