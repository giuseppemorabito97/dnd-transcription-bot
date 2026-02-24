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
  },
  whisper: {
    model: process.env.WHISPER_MODEL || 'large-v3',
    language: process.env.WHISPER_LANGUAGE || 'it', // Italian
  },
  paths: {
    root: rootDir,
    recordings: process.env.RECORDINGS_PATH || join(rootDir, 'recordings'),
    transcripts: process.env.TRANSCRIPTS_PATH || join(rootDir, 'transcripts'),
    transcriptsRevised: process.env.TRANSCRIPTS_REVISED_PATH || join(rootDir, 'transcripts-revised'),
  },
};
