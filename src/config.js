import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

export default {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    /** Nome del canale testuale dove inviare trascrizione e riassunto (es. "riassunti"). Se non esiste, si usa thread/canale corrente. */
    summaryChannelName: process.env.SUMMARY_CHANNEL_NAME || 'riassunti',
  },
  whisper: {
    model: process.env.WHISPER_MODEL || 'large-v3',
    language: process.env.WHISPER_LANGUAGE || 'it', // Italian
    /** Durata in secondi di ogni chunk audio (0 = nessun chunking). Default 600 = 10 min per ridurre ripetizioni/hallucinations. */
    chunkDurationSeconds: (() => {
      const v = parseInt(process.env.WHISPER_CHUNK_DURATION_SECONDS ?? '600', 10);
      return Number.isFinite(v) && v >= 0 ? v : 600;
    })(),
  },
  paths: {
    root: rootDir,
    recordings: process.env.RECORDINGS_PATH || join(rootDir, 'recordings'),
    transcripts: process.env.TRANSCRIPTS_PATH || join(rootDir, 'transcripts'),
    transcriptsRevised: process.env.TRANSCRIPTS_REVISED_PATH || join(rootDir, 'transcripts-revised'),
  },
};
