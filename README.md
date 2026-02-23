# D&D Transcription Bot

A Discord bot that joins voice channels, records audio from D&D sessions, and generates transcriptions using Whisper AI.

## Features

- Join and leave voice channels on command
- Record audio from all participants
- Generate transcriptions with timestamps
- Save transcripts as `.txt` files
- Local transcription using Whisper (no cloud API needed)

## Prerequisites

### System Requirements

- Node.js 18.x or higher
- FFmpeg (for audio processing)
- Python 3.x (for Whisper, if not using whisper-node)

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

### Install Whisper

**Option 1: Python Whisper (recommended for quality)**
```bash
pip install openai-whisper
```

**Option 2: whisper-node (used by default)**
The bot will automatically use the `whisper-node` npm package, which downloads models on first run.

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

1. Clone or download this project:
```bash
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
WHISPER_MODEL=base
```

**Finding your IDs:**
- `CLIENT_ID`: In Developer Portal > Your App > "Application ID"
- `GUILD_ID`: Right-click your Discord server > "Copy Server ID" (Enable Developer Mode in Discord settings first)

5. Deploy slash commands:
```bash
npm run deploy-commands
```

6. Start the bot:
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
6. The bot will generate a transcript and post it in the channel

### Output

Transcripts are saved to the `transcripts/` folder with the format:
```
D&D Session Transcript
Session: session_2024-01-15T20-30-00
Date: 1/15/2024, 8:30:00 PM
==================================================

[00:00 - 00:05]
Welcome everyone to tonight's session...

[00:05 - 00:12]
Last time, our heroes found themselves...
```

## Whisper Models

| Model | Quality | Speed | RAM Usage |
|-------|---------|-------|-----------|
| `tiny` | Basic | Fastest | ~75MB |
| `base` | Good | Fast | ~150MB |
| `small` | Better | Medium | ~500MB |
| `medium` | High | Slow | ~1.5GB |
| `large` | Best | Slowest | ~3GB |

Set the model in `.env`:
```env
WHISPER_MODEL=small
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

### Transcription fails
- Install Python Whisper as a fallback: `pip install openai-whisper`
- Check available disk space (models can be large)
- Try a smaller model in `.env`

### @discordjs/opus installation issues

**macOS:**
```bash
brew install opus
npm rebuild @discordjs/opus
```

**Ubuntu/Debian:**
```bash
sudo apt install libopus-dev
npm rebuild @discordjs/opus
```

## Project Structure

```
dnd-transcription-bot/
├── package.json
├── .env                    # Your configuration (create from .env.example)
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
│   │   └── audioStream.js # Audio stream processing
│   └── transcription/
│       └── whisper.js     # Whisper integration
├── recordings/            # Temporary audio files
└── transcripts/           # Generated transcripts
```

## License

MIT
