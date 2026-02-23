import { EventEmitter } from 'events';
import { writeFile } from 'fs/promises';

/**
 * Audio mixer that collects Opus packets and decodes them using WASM
 * Avoids native module crashes and OGG container issues
 */
export class AudioMixer extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map();
    this.opusPackets = [];
    this.isRunning = false;
    this.silenceInterval = null;
    this.decoder = null;
  }

  addStream(userId, opusStream) {
    // Store raw Opus packets for later processing
    opusStream.on('data', chunk => {
      try {
        this.opusPackets.push(Buffer.from(chunk));
      } catch (e) {
        // Ignore errors
      }
    });

    opusStream.on('error', error => {
      console.error(`[AudioMixer] Stream error for ${userId}:`, error.message);
    });

    this.streams.set(userId, { opusStream });

    if (!this.isRunning) {
      this.startOutput();
    }
  }

  removeStream(userId) {
    const stream = this.streams.get(userId);
    if (stream) {
      this.streams.delete(userId);
    }

    if (this.streams.size === 0) {
      this.stopOutput();
    }
  }

  startOutput() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Emit dummy data for progress tracking
    this.silenceInterval = setInterval(() => {
      this.emit('data', Buffer.alloc(3840));
    }, 1000);
  }

  stopOutput() {
    if (this.silenceInterval) {
      clearInterval(this.silenceInterval);
      this.silenceInterval = null;
    }
    this.isRunning = false;
  }

  getPacketCount() {
    return this.opusPackets.length;
  }

  /**
   * Decode Opus packets to PCM using WASM decoder
   */
  async decodeOpusPackets() {
    const { OpusDecodedAudio, OpusDecoder } = await import('opus-decoder');

    console.log(`[AudioMixer] Decoding ${this.opusPackets.length} Opus packets with WASM decoder...`);

    // Create decoder for Discord's audio format: 48kHz stereo
    const decoder = new OpusDecoder({
      channels: 2,
      sampleRate: 48000,
    });

    await decoder.ready;

    const pcmChunks = [];
    let decodedCount = 0;
    let errorCount = 0;

    for (const packet of this.opusPackets) {
      try {
        const decoded = decoder.decodeFrame(new Uint8Array(packet));
        if (decoded && decoded.channelData && decoded.channelData[0]) {
          // Convert stereo to mono by averaging channels
          const left = decoded.channelData[0];
          const right = decoded.channelData[1] || left;
          const mono = new Float32Array(left.length);
          for (let i = 0; i < left.length; i++) {
            mono[i] = (left[i] + right[i]) / 2;
          }
          pcmChunks.push(mono);
          decodedCount++;
        }
      } catch (e) {
        errorCount++;
        // Some packets may be corrupted, continue with others
      }
    }

    decoder.free();

    console.log(`[AudioMixer] Decoded ${decodedCount} packets, ${errorCount} errors`);

    if (pcmChunks.length === 0) {
      throw new Error('No audio could be decoded');
    }

    // Concatenate all PCM chunks
    const totalLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcmData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      samples: pcmData,
      sampleRate: 48000
    };
  }

  /**
   * Resample audio from one sample rate to another
   */
  resample(samples, fromRate, toRate) {
    if (fromRate === toRate) return samples;

    const ratio = fromRate / toRate;
    const newLength = Math.floor(samples.length / ratio);
    const resampled = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
      const t = srcIndex - srcIndexFloor;

      // Linear interpolation
      resampled[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t;
    }

    return resampled;
  }

  /**
   * Convert float32 samples to int16 for WAV
   */
  floatTo16BitPCM(samples) {
    const buffer = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      buffer.writeInt16LE(Math.round(val), i * 2);
    }
    return buffer;
  }

  /**
   * Create WAV file header
   */
  createWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    // RIFF chunk
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);           // chunk size
    header.writeUInt16LE(1, 20);            // audio format (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
  }

  /**
   * Save collected audio to WAV file
   */
  async saveToWav(outputPath) {
    if (this.opusPackets.length === 0) {
      throw new Error('No audio packets collected');
    }

    console.log(`[AudioMixer] Processing ${this.opusPackets.length} Opus packets...`);

    // Decode Opus to PCM
    const { samples, sampleRate } = await this.decodeOpusPackets();

    // Resample from 48kHz to 16kHz for Whisper
    const targetRate = 16000;
    const resampled = this.resample(samples, sampleRate, targetRate);

    console.log(`[AudioMixer] Resampled from ${sampleRate}Hz to ${targetRate}Hz`);

    // Convert to 16-bit PCM
    const pcmData = this.floatTo16BitPCM(resampled);

    // Create WAV file
    const header = this.createWavHeader(pcmData.length, targetRate, 1, 16);
    const wavData = Buffer.concat([header, pcmData]);

    await writeFile(outputPath, wavData);
    console.log(`[AudioMixer] Saved WAV to ${outputPath} (${(wavData.length / 1024).toFixed(1)} KB)`);

    return outputPath;
  }

  stop() {
    this.stopOutput();

    const userIds = [...this.streams.keys()];
    for (const userId of userIds) {
      this.removeStream(userId);
    }
  }
}
