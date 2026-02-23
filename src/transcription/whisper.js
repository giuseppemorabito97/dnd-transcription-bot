import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, basename } from 'path';
import config from '../config.js';

/**
 * Transcribe audio file using Whisper
 * @param {string} audioPath - Path to the WAV audio file
 * @param {string} sessionName - Name for the output transcript
 * @returns {Promise<string>} Path to the generated transcript file
 */
export async function transcribeAudio(audioPath, sessionName) {
  // Ensure transcripts directory exists
  if (!existsSync(config.paths.transcripts)) {
    mkdirSync(config.paths.transcripts, { recursive: true });
  }

  const transcriptPath = join(config.paths.transcripts, `${sessionName}.txt`);

  console.log(`[Whisper] Starting transcription: ${audioPath}`);
  console.log(`[Whisper] Using model: ${config.whisper.model}`);

  try {
    // Try to use whisper-node
    const { whisper } = await import('whisper-node');

    const options = {
      modelName: config.whisper.model,
      // whisper-node will auto-download the model if not present
    };

    const transcript = await whisper(audioPath, options);

    // Format transcript with timestamps
    let formattedTranscript = `D&D Session Transcript\n`;
    formattedTranscript += `Session: ${sessionName}\n`;
    formattedTranscript += `Date: ${new Date().toLocaleString()}\n`;
    formattedTranscript += `${'='.repeat(50)}\n\n`;

    if (Array.isArray(transcript)) {
      // whisper-node returns array of segments
      for (const segment of transcript) {
        const startTime = formatTimestamp(segment.start);
        const endTime = formatTimestamp(segment.end);
        formattedTranscript += `[${startTime} - ${endTime}]\n`;
        formattedTranscript += `${segment.speech.trim()}\n\n`;
      }
    } else if (typeof transcript === 'string') {
      formattedTranscript += transcript;
    } else {
      formattedTranscript += JSON.stringify(transcript, null, 2);
    }

    await writeFile(transcriptPath, formattedTranscript, 'utf-8');

    console.log(`[Whisper] Transcription complete: ${transcriptPath}`);

    return transcriptPath;
  } catch (whisperNodeError) {
    console.error('[Whisper] whisper-node failed:', whisperNodeError.message);

    // Fallback: try using whisper CLI directly
    try {
      const transcriptFromCLI = await transcribeWithCLI(audioPath, sessionName);
      return transcriptFromCLI;
    } catch (cliError) {
      console.error('[Whisper] CLI fallback also failed:', cliError.message);

      // Create a placeholder transcript file
      const placeholderContent =
        `D&D Session Transcript\n` +
        `Session: ${sessionName}\n` +
        `Date: ${new Date().toLocaleString()}\n` +
        `${'='.repeat(50)}\n\n` +
        `[Transcription Failed]\n\n` +
        `Audio file saved at: ${audioPath}\n\n` +
        `Error: ${whisperNodeError.message}\n\n` +
        `To transcribe manually, install Whisper and run:\n` +
        `whisper "${audioPath}" --model ${config.whisper.model} --output_dir "${config.paths.transcripts}"\n`;

      await writeFile(transcriptPath, placeholderContent, 'utf-8');

      return transcriptPath;
    }
  }
}

/**
 * Fallback: use Whisper CLI if whisper-node doesn't work
 */
async function transcribeWithCLI(audioPath, sessionName) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const outputDir = config.paths.transcripts;
  const transcriptPath = join(outputDir, `${sessionName}.txt`);

  // Try whisper command (Python package)
  try {
    console.log('[Whisper] Trying whisper CLI...');

    await execAsync(
      `whisper "${audioPath}" --model ${config.whisper.model} ` +
        `--output_dir "${outputDir}" --output_format txt`,
      { timeout: 600000 } // 10 minute timeout
    );

    // Whisper CLI outputs with the original filename
    const audioBasename = basename(audioPath, '.wav');
    const cliOutputPath = join(outputDir, `${audioBasename}.txt`);

    // Read and reformat with our header
    if (existsSync(cliOutputPath)) {
      const { readFile } = await import('fs/promises');
      const rawTranscript = await readFile(cliOutputPath, 'utf-8');

      const formattedTranscript =
        `D&D Session Transcript\n` +
        `Session: ${sessionName}\n` +
        `Date: ${new Date().toLocaleString()}\n` +
        `${'='.repeat(50)}\n\n` +
        rawTranscript;

      await writeFile(transcriptPath, formattedTranscript, 'utf-8');

      console.log(`[Whisper] CLI transcription complete: ${transcriptPath}`);
      return transcriptPath;
    }

    throw new Error('CLI output file not found');
  } catch (error) {
    // Try whisper.cpp if Python whisper not available
    console.log('[Whisper] Trying whisper.cpp CLI...');

    try {
      await execAsync(
        `./main -m models/ggml-${config.whisper.model}.bin -f "${audioPath}" -otxt`,
        {
          cwd: process.env.WHISPER_CPP_PATH || '.',
          timeout: 600000,
        }
      );

      const cppOutputPath = audioPath.replace('.wav', '.txt');

      if (existsSync(cppOutputPath)) {
        const { readFile, rename } = await import('fs/promises');
        const rawTranscript = await readFile(cppOutputPath, 'utf-8');

        const formattedTranscript =
          `D&D Session Transcript\n` +
          `Session: ${sessionName}\n` +
          `Date: ${new Date().toLocaleString()}\n` +
          `${'='.repeat(50)}\n\n` +
          rawTranscript;

        await writeFile(transcriptPath, formattedTranscript, 'utf-8');

        console.log(`[Whisper] whisper.cpp transcription complete: ${transcriptPath}`);
        return transcriptPath;
      }
    } catch (cppError) {
      throw new Error(`Both whisper CLI methods failed: ${error.message}, ${cppError.message}`);
    }
  }
}

/**
 * Format milliseconds to MM:SS timestamp
 */
function formatTimestamp(ms) {
  if (typeof ms !== 'number') return '00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
