# D&D Transcription Bot

A Discord bot that joins voice channels, records audio from D&D sessions, and generates high-quality transcriptions with speaker identification using Whisper AI and Ollama (local AI).

## Features

- **Voice Recording**: Join voice channels and record all participants
- **Speaker Identification**: Automatically detects and labels who said what
- **Chronological Order**: Transcripts show conversation flow in order of speaking
- **Whisper AI**: Local transcription using Whisper large-v3 model (best quality)
- **Ollama Enhancement**: Local AI post-processing to improve transcript readability (no API costs!)
- **Italian Optimized**: Configured for Italian language (easily changeable)
- **Dual Output**: Get both raw and AI-enhanced transcripts

## How It Works

1. Bot joins your voice channel and records each speaker separately
2. Whisper (large-v3) transcribes each speaker's audio
3. Ollama (local LLM) processes the transcript to fix errors and improve readability
4. You receive both the original and enhanced versions

## Prerequisites

### System Requirements

- Node.js 18.x or higher
- FFmpeg (for audio processing)
- ~10GB RAM (for Whisper large-v3 model)
- ~3GB disk space (for model files)

### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH.

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section
4. Click "Reset Token" and copy your bot token
5. Enable these Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent
6. Go to "OAuth2" > "URL Generator"
7. Select scopes: `bot`, `applications.commands`
8. Select permissions:
   - Connect
   - Speak
   - Send Messages
   - Use Slash Commands
9. Copy the generated URL and open it to invite the bot to your server

## Installation

1. Clone the repository:
```bash
git clone https://github.com/giuseppemorabito97/dnd-transcription-bot.git
cd dnd-transcription-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create your `.env` file:
```bash
cp .env.example .env
```

4. Edit `.env` and add your credentials:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_discord_server_id_here
WHISPER_MODEL=large-v3
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

**Finding your IDs:**
- `CLIENT_ID`: In Developer Portal > Your App > "Application ID"
- `GUILD_ID`: Right-click your Discord server > "Copy Server ID" (Enable Developer Mode in Discord settings first)

5. Install and start Ollama:
```bash
# macOS
brew install ollama
brew services start ollama
ollama pull llama3.2

# Linux
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull llama3.2
```

6. Download the Whisper model (first run will do this automatically, or manually):
```bash
cd node_modules/whisper-node/dist/cpp/whisper.cpp
bash models/download-ggml-model.sh large-v3
```

7. Deploy slash commands:
```bash
npm run deploy-commands
```

8. Start the bot:
```bash
npm start
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/join` | Bot joins your current voice channel |
| `/leave` | Bot leaves the voice channel |
| `/start` | Start recording the session |
| `/start session:my-campaign` | Start with a custom session name |
| `/stop` | Stop recording and generate transcription |

### Workflow

1. Join a voice channel with your D&D group
2. Use `/join` to bring the bot into the channel
3. Use `/start` to begin recording
4. Play your D&D session
5. Use `/stop` when finished
6. The bot will:
   - Transcribe each speaker with Whisper
   - Process with Ollama for better readability
   - Post both versions in the channel

### Output Example

**Original (Whisper):**
```
D&D Session Transcript
Session: session_2024-01-15T20-30-00
Date: 1/15/2024, 8:30:00 PM
Speakers: Paolo, Giuseppe, Dario
==================================================

[00:01] **Paolo:**
ok quindi noi dobbiamo andare a scorrere bene per favore dai dai dai

[00:05] **Giuseppe:**
è una scorrina di bene per farlo dove che prendo cosa
```

**Revised (Ollama):**
```
D&D Session Transcript (Revised by Ollama/llama3.2)
Session: session_2024-01-15T20-30-00
==================================================

[00:01] **Paolo:**
Ok, quindi noi dobbiamo andare a esplorare. Bene, per favore, dai dai dai!

[00:05] **Giuseppe:**
È una cosa importante da fare. Dove prendo cosa?
```

## Whisper Models

| Model | Quality | Speed | RAM Usage | Disk |
|-------|---------|-------|-----------|------|
| `tiny` | Basic | Fastest | ~1GB | 75MB |
| `base` | Good | Fast | ~1GB | 150MB |
| `small` | Better | Medium | ~2GB | 500MB |
| `medium` | High | Slow | ~5GB | 1.5GB |
| `large-v3` | **Best** | Slowest | ~10GB | 3GB |

Default is `large-v3` for best Italian recognition. Change in `.env`:
```env
WHISPER_MODEL=medium
```

## Configuration

### Language

Default language is Italian. To change, edit `src/config.js`:
```javascript
whisper: {
  model: process.env.WHISPER_MODEL || 'large-v3',
  language: process.env.WHISPER_LANGUAGE || 'en', // Change to your language
},
```

### Disable Ollama Processing

If you don't want Ollama post-processing, stop the Ollama service. The bot will still work with just Whisper (original transcript only).

### Change Ollama Model

You can use any model available in Ollama. Some options:
```bash
ollama pull llama3.2      # Default, good balance
ollama pull mistral       # Fast and capable
ollama pull llama3.1:8b   # Larger, better quality
```

Then update `.env`:
```env
OLLAMA_MODEL=mistral
```

## Project Structure

```
dnd-transcription-bot/
├── package.json
├── .env                    # Your configuration (create from .env.example)
├── .env.example            # Template for environment variables
├── src/
│   ├── index.js           # Bot entry point
│   ├── config.js          # Configuration loader
│   ├── deploy-commands.js # Slash command registration
│   ├── commands/
│   │   ├── join.js        # /join command
│   │   ├── leave.js       # /leave command
│   │   ├── start.js       # /start command
│   │   └── stop.js        # /stop command
│   ├── voice/
│   │   ├── recorder.js    # Audio recording handler
│   │   └── audioStream.js # WASM Opus decoder & audio mixing
│   └── transcription/
│       ├── whisper.js     # Whisper integration
│       └── ollamaProcessor.js # Ollama AI enhancement
├── recordings/            # Temporary audio files (per-user WAV)
├── transcripts/           # Original Whisper transcripts
└── transcripts-revised/   # Claude-enhanced transcripts
```

## Troubleshooting

### Bot doesn't respond to commands
- Make sure you ran `npm run deploy-commands`
- Check that the bot has the correct permissions
- Verify your `GUILD_ID` is correct

### "Cannot find module" errors
```bash
npm install
```

### Audio recording issues
- Ensure FFmpeg is installed
- Check that the bot has "Connect" and "Speak" permissions
- Try disconnecting and reconnecting the bot

### Transcription quality is poor
- Make sure you're using `large-v3` model
- Check that the audio files are being saved (look in `recordings/`)
- Ensure speakers are close to their microphones

### Ollama processing fails
- Make sure Ollama is running: `ollama serve`
- Check if the model is downloaded: `ollama list`
- Pull the model if missing: `ollama pull llama3.2`
- The original transcript will still be available

### Whisper model not found
```bash
cd node_modules/whisper-node/dist/cpp/whisper.cpp
bash models/download-ggml-model.sh large-v3
```

### High memory usage
- Use a smaller model: `WHISPER_MODEL=medium` or `small`
- The `large-v3` model needs ~10GB RAM during transcription

## Tech Stack

- **Discord.js** - Discord bot framework
- **@discordjs/voice** - Voice channel connections
- **opus-decoder** - WASM-based Opus audio decoding
- **whisper.cpp** - Local Whisper AI transcription
- **Ollama** - Local LLM for text enhancement (no API costs!)

## License

MIT

## Credits

Built with Whisper by OpenAI and Ollama for local AI processing.
