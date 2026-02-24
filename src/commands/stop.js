import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { transcribeAudio, transcribeWithSpeakers } from '../transcription/whisper.js';
import { processWithOllama } from '../transcription/ollamaProcessor.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import config from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop recording and generate transcription');

export async function execute(interaction, client) {
  const connection = getVoiceConnection(interaction.guildId);
  const session = client.recordingSessions.get(interaction.guildId);

  if (!connection || !session) {
    return interaction.reply({
      content: 'No active session found.',
      ephemeral: true,
    });
  }

  if (!session.recording) {
    return interaction.reply({
      content: 'Not currently recording. Use `/start` to begin.',
      ephemeral: true,
    });
  }

  // Acknowledge the command (transcription may take time)
  await interaction.deferReply();

  try {
    // Calculate recording duration
    const duration = Math.round((Date.now() - session.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    // Get user IDs before stopping
    const userIds = session.recorder.getUserIds();
    const userCount = userIds.length;

    await interaction.editReply({
      content: `⏹️ **Recording stopped**\n` +
        `Duration: ${minutes}m ${seconds}s\n` +
        `Speakers detected: ${userCount}\n\n` +
        `🔄 Processing transcription for each speaker... This may take a moment.`,
    });

    // Save per-user audio files
    const userAudioFiles = await session.recorder.saveAllUserAudio(config.paths.recordings);

    // Stop recording (this also saves the mixed audio)
    const audioFilePath = await session.recorder.stop();

    // Update session state
    session.recording = false;

    // Get speaking segments for chronological ordering
    const speakingSegments = session.recorder.getSpeakingSegments();

    // Generate transcription with speaker labels
    let transcriptPath;
    if (Object.keys(userAudioFiles).length > 0) {
      // Use per-speaker transcription with chronological order
      transcriptPath = await transcribeWithSpeakers(userAudioFiles, session.sessionName, speakingSegments);
    } else {
      // Fallback to mixed audio transcription
      transcriptPath = await transcribeAudio(audioFilePath, session.sessionName);
    }

    if (transcriptPath && existsSync(transcriptPath)) {
      // Update user that we're now processing with Ollama
      await interaction.editReply({
        content: `⏹️ **Recording stopped**\n` +
          `Duration: ${minutes}m ${seconds}s\n` +
          `Speakers detected: ${userCount}\n\n` +
          `✅ Transcription complete!\n` +
          `🦙 Processing with Ollama for better readability...`,
      });

      // Process with Ollama to improve readability
      const revisedPath = await processWithOllama(transcriptPath, session.sessionName);

      // Prepare attachments
      const files = [];

      // Original transcript
      const originalAttachment = new AttachmentBuilder(transcriptPath, {
        name: `${session.sessionName}_original.txt`,
      });
      files.push(originalAttachment);

      // Revised transcript (if available)
      let revisedPreview = '';
      if (revisedPath && existsSync(revisedPath)) {
        const revisedAttachment = new AttachmentBuilder(revisedPath, {
          name: `${session.sessionName}_revised.txt`,
        });
        files.push(revisedAttachment);

        // Read revised for preview
        const revisedContent = await readFile(revisedPath, 'utf-8');
        revisedPreview = revisedContent.length > 1500
          ? revisedContent.slice(0, 1500) + '\n\n... (truncated, see full file)'
          : revisedContent;
      }

      // Send final message with attachments
      const content = revisedPath && existsSync(revisedPath)
        ? `✅ **Transcription complete!**\n` +
          `Session: \`${session.sessionName}\`\n` +
          `Duration: ${minutes}m ${seconds}s\n\n` +
          `📄 **Original transcript** + 🦙 **Revised by Ollama**\n\n` +
          `**Preview (Revised):**\n\`\`\`\n${revisedPreview}\n\`\`\``
        : `✅ **Transcription complete!**\n` +
          `Session: \`${session.sessionName}\`\n` +
          `Duration: ${minutes}m ${seconds}s\n\n` +
          `⚠️ Ollama processing failed, original transcript attached.`;

      await interaction.editReply({
        content,
        files,
      });
    } else {
      await interaction.editReply({
        content:
          `⚠️ **Recording saved but transcription failed**\n` +
          `Session: \`${session.sessionName}\`\n` +
          `Audio file: \`${audioFilePath}\`\n\n` +
          `You can manually transcribe the audio file later.`,
      });
    }
  } catch (error) {
    console.error('[Stop] Error:', error);
    await interaction.editReply({
      content: 'An error occurred while processing the recording.',
    });
  }
}
