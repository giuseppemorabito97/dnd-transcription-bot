import { EventEmitter } from 'events';
import { writeFile } from 'fs/promises';

/**
 * Audio mixer that collects Opus packets per user for speaker identification
 * Avoids native module crashes and OGG container issues
 */
export class AudioMixer extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map();
    this.userPackets = new Map(); // userId -> [{packet, timestamp}]
    this.isRunning = false;
    this.silenceInterval = null;
    this.startTime = Date.now();
  }

  addStream(userId, opusStream) {
    // Initialize packet storage for this user
    if (!this.userPackets.has(userId)) {
      this.userPackets.set(userId, []);
    }

    // Store raw Opus packets with timestamps for this specific user
    opusStream.on('data', chunk => {
      try {
        const packets = this.userPackets.get(userId);
        packets.push({
          packet: Buffer.from(chunk),
          timestamp: Date.now() - this.startTime
        });
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
    let total = 0;
    for (const packets of this.userPackets.values()) {
      total += packets.length;
    }
    return total;
  }

  getUserIds() {
    return [...this.userPackets.keys()];
  }

  /**
   * Decode Opus packets for a specific user to PCM using WASM decoder
   */
  async decodeUserPackets(userId) {
    const packets = this.userPackets.get(userId);
    if (!packets || packets.length === 0) {
      return null;
    }

    const { OpusDecoder } = await import('opus-decoder');

    // Create decoder for Discord's audio format: 48kHz stereo
    const decoder = new OpusDecoder({
      channels: 2,
      sampleRate: 48000,
    });

    await decoder.ready;

    const pcmChunks = [];
    let decodedCount = 0;

    for (const { packet } of packets) {
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
        // Some packets may be corrupted, continue with others
      }
    }

    decoder.free();

    if (pcmChunks.length === 0) {
      return null;
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
      sampleRate: 48000,
      packetCount: decodedCount
    };
  }

  /**
   * Decode all Opus packets (mixed) to PCM using WASM decoder
   */
  async decodeOpusPackets() {
    // Combine all user packets sorted by timestamp
    const allPackets = [];
    for (const [userId, packets] of this.userPackets) {
      for (const p of packets) {
        allPackets.push(p.packet);
      }
    }

    if (allPackets.length === 0) {
      throw new Error('No audio packets collected');
    }

    const { OpusDecoder } = await import('opus-decoder');

    console.log(`[AudioMixer] Decoding ${allPackets.length} Opus packets with WASM decoder...`);

    // Create decoder for Discord's audio format: 48kHz stereo
    const decoder = new OpusDecoder({
      channels: 2,
      sampleRate: 48000,
    });

    await decoder.ready;

    const pcmChunks = [];
    let decodedCount = 0;
    let errorCount = 0;

    for (const packet of allPackets) {
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
   * Save collected audio to WAV file (mixed)
   */
  async saveToWav(outputPath) {
    const packetCount = this.getPacketCount();
    if (packetCount === 0) {
      throw new Error('No audio packets collected');
    }

    console.log(`[AudioMixer] Processing ${packetCount} Opus packets...`);

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

  /**
   * Save audio for a specific user to WAV file
   */
  async saveUserToWav(userId, outputPath) {
    const decoded = await this.decodeUserPackets(userId);
    if (!decoded) {
      return null;
    }

    const { samples, sampleRate, packetCount } = decoded;

    // Resample from 48kHz to 16kHz for Whisper
    const targetRate = 16000;
    const resampled = this.resample(samples, sampleRate, targetRate);

    // Convert to 16-bit PCM
    const pcmData = this.floatTo16BitPCM(resampled);

    // Create WAV file
    const header = this.createWavHeader(pcmData.length, targetRate, 1, 16);
    const wavData = Buffer.concat([header, pcmData]);

    await writeFile(outputPath, wavData);
    console.log(`[AudioMixer] Saved user ${userId} WAV to ${outputPath} (${(wavData.length / 1024).toFixed(1)} KB, ${packetCount} packets)`);

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
