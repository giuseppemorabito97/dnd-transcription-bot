import { existsSync, mkdirSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

/**
 * Transcribe audio file using Whisper
 * @param {string} audioPath - Path to the WAV audio file
 * @param {string} sessionName - Name for the output transcript
 * @returns {Promise<string>} Path to the generated transcript file
 */
export async function transcribeAudio(audioPath, sessionName) {
  // Ensure transcripts directory exists
  const transcriptsDir = join(PROJECT_ROOT, 'transcripts');
  if (!existsSync(transcriptsDir)) {
    mkdirSync(transcriptsDir, { recursive: true });
  }

  const transcriptPath = join(transcriptsDir, `${sessionName}.txt`);

  console.log(`[Whisper] Starting transcription: ${audioPath}`);
  console.log(`[Whisper] Output: ${transcriptPath}`);

  // Path to whisper.cpp in whisper-node
  const whisperCppPath = join(PROJECT_ROOT, 'node_modules', 'whisper-node', 'dist', 'cpp', 'whisper.cpp');
  const modelPath = join(whisperCppPath, 'models', `ggml-${config.whisper.model}.bin`);
  const mainPath = join(whisperCppPath, 'build', 'bin', 'whisper-cli');

  console.log(`[Whisper] Model path: ${modelPath}`);
  console.log(`[Whisper] Model exists: ${existsSync(modelPath)}`);

  if (!existsSync(modelPath)) {
    console.error(`[Whisper] Model not found at ${modelPath}`);
    return createPlaceholderTranscript(transcriptPath, sessionName, audioPath, 'Model not found');
  }

  try {
    // Use whisper.cpp directly
    const transcript = await runWhisperCpp(mainPath, modelPath, audioPath);

    // Format transcript
    let formattedTranscript = `D&D Session Transcript\n`;
    formattedTranscript += `Session: ${sessionName}\n`;
    formattedTranscript += `Date: ${new Date().toLocaleString()}\n`;
    formattedTranscript += `${'='.repeat(50)}\n\n`;
    formattedTranscript += transcript;

    await writeFile(transcriptPath, formattedTranscript, 'utf-8');
    console.log(`[Whisper] Transcription complete: ${transcriptPath}`);

    return transcriptPath;
  } catch (error) {
    console.error('[Whisper] Transcription failed:', error.message);
    return createPlaceholderTranscript(transcriptPath, sessionName, audioPath, error.message);
  }
}

/**
 * Run whisper.cpp main binary
 */
async function runWhisperCpp(mainPath, modelPath, audioPath) {
  return new Promise((resolve, reject) => {
    console.log(`[Whisper] Running: ${mainPath} -m ${modelPath} -f ${audioPath}`);

    const proc = spawn(mainPath, [
      '-m', modelPath,
      '-f', audioPath,
      '--no-timestamps',
      '-l', 'auto'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    proc.on('close', code => {
      if (code === 0) {
        // Clean up whisper output (remove timing info, etc.)
        const lines = stdout.split('\n')
          .filter(line => !line.startsWith('[') && line.trim())
          .join('\n')
          .trim();
        resolve(lines || stdout.trim());
      } else {
        reject(new Error(`whisper.cpp exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', err => {
      reject(err);
    });
  });
}

/**
 * Create placeholder transcript when transcription fails
 */
async function createPlaceholderTranscript(transcriptPath, sessionName, audioPath, errorMsg) {
  const content =
    `D&D Session Transcript\n` +
    `Session: ${sessionName}\n` +
    `Date: ${new Date().toLocaleString()}\n` +
    `${'='.repeat(50)}\n\n` +
    `[Transcription Failed]\n\n` +
    `Audio file saved at: ${audioPath}\n\n` +
    `Error: ${errorMsg}\n`;

  await writeFile(transcriptPath, content, 'utf-8');
  return transcriptPath;
}

/**
 * Transcribe audio for multiple users and combine with speaker labels
 * @param {Object} userAudioFiles - Map of userId -> {path, userName}
 * @param {string} sessionName - Name for the output transcript
 * @returns {Promise<string>} Path to the generated transcript file
 */
export async function transcribeWithSpeakers(userAudioFiles, sessionName) {
  // Ensure transcripts directory exists
  const transcriptsDir = join(PROJECT_ROOT, 'transcripts');
  if (!existsSync(transcriptsDir)) {
    mkdirSync(transcriptsDir, { recursive: true });
  }

  const transcriptPath = join(transcriptsDir, `${sessionName}.txt`);

  // Path to whisper.cpp
  const whisperCppPath = join(PROJECT_ROOT, 'node_modules', 'whisper-node', 'dist', 'cpp', 'whisper.cpp');
  const modelPath = join(whisperCppPath, 'models', `ggml-${config.whisper.model}.bin`);
  const mainPath = join(whisperCppPath, 'build', 'bin', 'whisper-cli');

  if (!existsSync(modelPath)) {
    console.error(`[Whisper] Model not found at ${modelPath}`);
    return createPlaceholderTranscript(transcriptPath, sessionName, 'multiple files', 'Model not found');
  }

  const userTranscripts = [];

  // Transcribe each user's audio
  for (const [userId, { path, userName }] of Object.entries(userAudioFiles)) {
    if (!existsSync(path)) {
      console.log(`[Whisper] Skipping ${userName}: audio file not found`);
      continue;
    }

    console.log(`[Whisper] Transcribing audio for ${userName}...`);

    try {
      const transcript = await runWhisperCpp(mainPath, modelPath, path);
      if (transcript && transcript.trim()) {
        userTranscripts.push({
          userName,
          userId,
          text: transcript.trim()
        });
        console.log(`[Whisper] Transcribed ${userName}: ${transcript.slice(0, 50)}...`);
      }
    } catch (error) {
      console.error(`[Whisper] Failed to transcribe ${userName}:`, error.message);
    }
  }

  // Format transcript with speaker labels
  let formattedTranscript = `D&D Session Transcript\n`;
  formattedTranscript += `Session: ${sessionName}\n`;
  formattedTranscript += `Date: ${new Date().toLocaleString()}\n`;
  formattedTranscript += `Speakers: ${userTranscripts.map(u => u.userName).join(', ')}\n`;
  formattedTranscript += `${'='.repeat(50)}\n\n`;

  if (userTranscripts.length === 0) {
    formattedTranscript += `[No speech detected]\n`;
  } else {
    for (const { userName, text } of userTranscripts) {
      formattedTranscript += `**${userName}:**\n`;
      formattedTranscript += `${text}\n\n`;
    }
  }

  await writeFile(transcriptPath, formattedTranscript, 'utf-8');
  console.log(`[Whisper] Transcription with speakers complete: ${transcriptPath}`);

  return transcriptPath;
}

