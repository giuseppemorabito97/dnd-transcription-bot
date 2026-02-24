import Anthropic from '@anthropic-ai/sdk';
import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const client = new Anthropic();

/**
 * Process a transcript with Claude to make it more readable
 * @param {string} transcriptPath - Path to the original transcript
 * @param {string} sessionName - Name of the session
 * @returns {Promise<string>} Path to the revised transcript
 */
export async function processWithClaude(transcriptPath, sessionName) {
  // Ensure revised transcripts directory exists
  const revisedDir = join(PROJECT_ROOT, 'transcripts-revised');
  if (!existsSync(revisedDir)) {
    mkdirSync(revisedDir, { recursive: true });
  }

  const revisedPath = join(revisedDir, `${sessionName}_revised.txt`);

  try {
    // Read the original transcript
    const originalTranscript = await readFile(transcriptPath, 'utf-8');

    console.log('[Claude] Processing transcript to improve readability...');

    // Call Claude to process the transcript
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Sei un assistente che migliora le trascrizioni audio di sessioni di D&D (Dungeons & Dragons).

Ecco una trascrizione automatica di una sessione. Il testo potrebbe contenere errori di riconoscimento vocale, parole incomprensibili, o frasi spezzate.

Il tuo compito è:
1. Correggere errori evidenti di trascrizione
2. Rendere le frasi più leggibili e coerenti
3. Mantenere il senso originale di quello che è stato detto
4. Mantenere i nomi degli speaker e i timestamp
5. Se una parte è incomprensibile, segnalala con [incomprensibile]
6. NON inventare contenuti che non sono presenti
7. Mantieni il formato con speaker e timestamp

TRASCRIZIONE ORIGINALE:
${originalTranscript}

Rispondi SOLO con la trascrizione migliorata, senza commenti aggiuntivi.`
        }
      ]
    });

    // Extract the text from Claude's response
    const revisedTranscript = message.content[0].text;

    // Add header to revised transcript
    let finalTranscript = `D&D Session Transcript (Revised by Claude)\n`;
    finalTranscript += `Original: ${sessionName}\n`;
    finalTranscript += `Revised: ${new Date().toLocaleString()}\n`;
    finalTranscript += `${'='.repeat(50)}\n\n`;
    finalTranscript += revisedTranscript;

    // Save the revised transcript
    await writeFile(revisedPath, finalTranscript, 'utf-8');
    console.log(`[Claude] Revised transcript saved: ${revisedPath}`);

    return revisedPath;
  } catch (error) {
    console.error('[Claude] Error processing transcript:', error.message);
    // Return null if processing fails - the original transcript is still available
    return null;
  }
}
