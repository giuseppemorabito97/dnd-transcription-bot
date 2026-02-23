import { SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Leave the voice channel');

export async function execute(interaction, client) {
  const connection = getVoiceConnection(interaction.guildId);

  if (!connection) {
    return interaction.reply({
      content: 'I\'m not in a voice channel!',
      ephemeral: true,
    });
  }

  const session = client.recordingSessions.get(interaction.guildId);

  // Check if recording is in progress
  if (session?.recording) {
    return interaction.reply({
      content: 'Recording is in progress! Use `/stop` first to save the transcription.',
      ephemeral: true,
    });
  }

  try {
    connection.destroy();
    client.recordingSessions.delete(interaction.guildId);

    await interaction.reply({
      content: 'Left the voice channel. See you next session!',
    });
  } catch (error) {
    console.error('[Leave] Error:', error);
    await interaction.reply({
      content: 'Failed to leave the voice channel.',
      ephemeral: true,
    });
  }
}
