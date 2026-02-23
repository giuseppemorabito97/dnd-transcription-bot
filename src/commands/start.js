import { SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { VoiceRecorder } from '../voice/recorder.js';

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Start recording the voice channel')
  .addStringOption(option =>
    option
      .setName('session')
      .setDescription('Session name (optional, defaults to timestamp)')
      .setRequired(false)
  );

export async function execute(interaction, client) {
  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    return interaction.reply({
      content: 'I\'m not in a voice channel! Use `/join` first.',
      ephemeral: true,
    });
  }

  const session = client.recordingSessions.get(interaction.guildId);

  if (!session) {
    return interaction.reply({
      content: 'Session not found. Please use `/join` again.',
      ephemeral: true,
    });
  }

  if (session.recording) {
    return interaction.reply({
      content: 'Already recording! Use `/stop` to finish.',
      ephemeral: true,
    });
  }

  const sessionName =
    interaction.options.getString('session') ||
    `session_${new Date().toISOString().replace(/[:.]/g, '-')}`;

  try {
    // Initialize voice recorder with client for fetching usernames
    const recorder = new VoiceRecorder(connection, interaction.guildId, sessionName, client);
    await recorder.start();

    // Update session state
    session.recording = true;
    session.startTime = Date.now();
    session.recorder = recorder;
    session.sessionName = sessionName;

    const channelName = session.voiceChannel.name;

    await interaction.reply({
      content: `🔴 **Recording started** in **${channelName}**\n` +
        `Session: \`${sessionName}\`\n\n` +
        `Use \`/stop\` to finish and generate transcription.`,
    });
  } catch (error) {
    console.error('[Start] Error:', error);
    await interaction.reply({
      content: 'Failed to start recording. Please try again.',
      ephemeral: true,
    });
  }
}
