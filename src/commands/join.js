import { SlashCommandBuilder } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';

export const data = new SlashCommandBuilder()
  .setName('join')
  .setDescription('Join your current voice channel');

export async function execute(interaction, client) {
  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: 'You need to be in a voice channel first!',
      ephemeral: true,
    });
  }

  // Check bot permissions
  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions.has('Connect') || !permissions.has('Speak')) {
    return interaction.reply({
      content: 'I need permissions to join and speak in your voice channel!',
      ephemeral: true,
    });
  }

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false, // Need to hear audio for recording
      selfMute: true,
    });

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Store connection reference
    client.recordingSessions.set(interaction.guildId, {
      connection,
      voiceChannel,
      recording: false,
      startTime: null,
      audioStreams: new Map(),
    });

    await interaction.reply({
      content: `Joined **${voiceChannel.name}**! Use \`/start\` to begin recording.`,
    });
  } catch (error) {
    console.error('[Join] Error:', error);
    await interaction.reply({
      content: 'Failed to join the voice channel. Please try again.',
      ephemeral: true,
    });
  }
}
