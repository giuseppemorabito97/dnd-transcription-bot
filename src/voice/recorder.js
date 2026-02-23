import { EndBehaviorType } from '@discordjs/voice';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AudioMixer } from './audioStream.js';
import config from '../config.js';

export class VoiceRecorder {
  constructor(connection, guildId, sessionName) {
    this.connection = connection;
    this.guildId = guildId;
    this.sessionName = sessionName;
    this.userStreams = new Map();
    this.mixer = new AudioMixer();
    this.outputPath = null;
    this.isRecording = false;
  }

  async start() {
    // Ensure recordings directory exists
    if (!existsSync(config.paths.recordings)) {
      mkdirSync(config.paths.recordings, { recursive: true });
    }

    this.outputPath = join(
      config.paths.recordings,
      `${this.sessionName}.wav`
    );

    this.isRecording = true;

    // Get the receiver from the voice connection
    const receiver = this.connection.receiver;

    // Listen for users speaking
    receiver.speaking.on('start', userId => {
      if (this.userStreams.has(userId)) return;

      console.log(`[Recorder] User ${userId} started speaking`);

      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000, // 1 second of silence before ending stream
        },
      });

      // Add stream to mixer (collects raw Opus packets)
      this.mixer.addStream(userId, audioStream);
      this.userStreams.set(userId, audioStream);

      // Handle stream end
      audioStream.on('end', () => {
        console.log(`[Recorder] User ${userId} stopped speaking`);
        this.userStreams.delete(userId);
        this.mixer.removeStream(userId);
      });

      audioStream.on('error', error => {
        console.error(`[Recorder] Stream error for user ${userId}:`, error.message);
        this.userStreams.delete(userId);
        this.mixer.removeStream(userId);
      });
    });

    console.log(`[Recorder] Recording started, collecting Opus packets...`);
  }

  async stop() {
    this.isRecording = false;

    // Stop all user streams
    for (const [userId, stream] of this.userStreams) {
      try {
        stream.destroy();
      } catch (e) {
        // Ignore
      }
      this.userStreams.delete(userId);
    }

    // Stop mixer
    this.mixer.stop();

    const packetCount = this.mixer.getPacketCount();
    console.log(`[Recorder] Recording stopped. Collected ${packetCount} audio packets.`);

    if (packetCount === 0) {
      console.log('[Recorder] No audio was recorded!');
      // Create empty WAV as fallback
      await this.createEmptyWav(this.outputPath);
      return this.outputPath;
    }

    // Convert Opus packets to WAV
    try {
      await this.mixer.saveToWav(this.outputPath);
      console.log(`[Recorder] Saved WAV: ${this.outputPath}`);
      return this.outputPath;
    } catch (error) {
      console.error('[Recorder] Error saving audio:', error.message);
      // Create empty WAV as fallback
      await this.createEmptyWav(this.outputPath);
      return this.outputPath;
    }
  }

  async createEmptyWav(wavPath) {
    const { writeFile } = await import('fs/promises');

    // Create a minimal WAV file with silence
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const duration = 1; // 1 second of silence
    const dataSize = sampleRate * channels * (bitsPerSample / 8) * duration;

    const header = Buffer.alloc(44 + dataSize);

    // RIFF chunk
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    await writeFile(wavPath, header);
    console.log(`[Recorder] Created empty WAV: ${wavPath}`);
  }
}
