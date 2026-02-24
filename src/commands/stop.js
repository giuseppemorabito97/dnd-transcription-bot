import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import {
  transcribeAudio,
  transcribeWithSpeakers,
} from "../transcription/whisper.js";
import { processWithOllama } from "../transcription/ollamaProcessor.js";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import config from "../config.js";

/** Se l'interazione è scaduta (10062), invia nel canale. */
async function replyOrSendToChannel(
  interaction,
  { content, files = [], isEdit = true },
) {
  try {
    if (isEdit) {
      await interaction.editReply({ content, files });
    } else {
      await interaction.followUp({ content, files });
    }
  } catch (err) {
    if (err.code === 10062 && interaction.channel) {
      await interaction.channel.send({ content, files });
    } else {
      throw err;
    }
  }
}

/** Nome thread sicuro (max 100 caratteri, niente caratteri problematici). */
function safeThreadName(sessionName) {
  const name = `Transcript ${sessionName}`
    .replace(/[^\p{L}\p{N}\s\-_]/gu, "")
    .trim()
    .slice(0, 100);
  return name || "Transcript";
}

/** Trova il canale testuale per i riassunti (es. #riassunti) nella guild. */
function getSummaryChannel(guild, channelName) {
  if (!guild || !channelName) return null;
  return guild.channels.cache.find(
    (c) =>
      c.name === channelName &&
      c.isTextBased() &&
      !c.isThread(),
  ) ?? null;
}

/** Invia contenuto e file al canale #riassunti (o nome configurato). */
async function sendToSummaryChannel(
  guild,
  channelName,
  content,
  files,
  summaryContent,
) {
  const channel = getSummaryChannel(guild, channelName);
  if (!channel) return false;
  await channel.send({ content, files });
  if (summaryContent) {
    await channel.send({ content: summaryContent });
  }
  return true;
}

/** Crea un thread e invia contenuto + file lì; in chat resta solo un messaggio breve. */
async function sendInThread(
  interaction,
  threadName,
  content,
  files = [],
  summaryContent = null,
) {
  const shortMsg = `✅ **Transcription complete!** Session: \`${threadName}\`\n📎 Vedi thread sotto per trascrizione e riassunto.`;
  const message = await interaction.editReply({ content: shortMsg });
  if (!message || typeof message.startThread !== "function") {
    throw new Error("Reply message not available for thread");
  }
  const thread = await message.startThread({
    name: safeThreadName(threadName),
    autoArchiveDuration: 60,
  });
  await thread.send({ content, files });
  if (summaryContent) {
    await thread.send({ content: summaryContent });
  }
}

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop recording and generate transcription");

export async function execute(interaction, client) {
  const connection = getVoiceConnection(interaction.guildId);
  const session = client.recordingSessions.get(interaction.guildId);

  if (!connection || !session) {
    return interaction.reply({
      content: "No active session found.",
      ephemeral: true,
    });
  }

  if (!session.recording) {
    return interaction.reply({
      content: "Not currently recording. Use `/start` to begin.",
      ephemeral: true,
    });
  }

  // Acknowledge the command (transcription may take time). Non-ephemeral so we can create a thread later.
  await interaction.deferReply({ ephemeral: false });

  try {
    // Calculate recording duration
    const duration = Math.round((Date.now() - session.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    // Get user IDs before stopping
    const userIds = session.recorder.getUserIds();
    const userCount = userIds.length;

    await replyOrSendToChannel(interaction, {
      content:
        `⏹️ **Recording stopped**\n` +
        `Duration: ${minutes}m ${seconds}s\n` +
        `Speakers detected: ${userCount}\n\n` +
        `🔄 Processing transcription for each speaker... This may take a moment.`,
      isEdit: true,
    });

    // Save per-user audio files
    const userAudioFiles = await session.recorder.saveAllUserAudio(
      config.paths.recordings,
    );

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
      transcriptPath = await transcribeWithSpeakers(
        userAudioFiles,
        session.sessionName,
        speakingSegments,
      );
    } else {
      // Fallback to mixed audio transcription
      transcriptPath = await transcribeAudio(
        audioFilePath,
        session.sessionName,
      );
    }

    if (transcriptPath && existsSync(transcriptPath)) {
      await replyOrSendToChannel(interaction, {
        content:
          `⏹️ **Recording stopped**\n` +
          `Duration: ${minutes}m ${seconds}s\n` +
          `Speakers detected: ${userCount}\n\n` +
          `✅ Transcription complete!\n` +
          `🦙 Processing with Ollama for better readability...`,
        isEdit: true,
      });

      // Process with Ollama (revise, chunk, embed, summary)
      const masterUsername =
        session.masterUserId != null
          ? session.recorder.getUserName(session.masterUserId)
          : undefined;
      const { revisedPath, summary } = await processWithOllama(
        transcriptPath,
        session.sessionName,
        { masterUsername },
      );

      // Prepare attachments
      const files = [];

      // Original transcript
      const originalAttachment = new AttachmentBuilder(transcriptPath, {
        name: `${session.sessionName}_original.txt`,
      });
      files.push(originalAttachment);

      // Revised transcript (if available)
      let revisedPreview = "";
      if (revisedPath && existsSync(revisedPath)) {
        const revisedAttachment = new AttachmentBuilder(revisedPath, {
          name: `${session.sessionName}_revised.txt`,
        });
        files.push(revisedAttachment);

        // Read revised for preview (primi 1200 char per lasciare spazio al riassunto)
        const revisedContent = await readFile(revisedPath, "utf-8");
        revisedPreview =
          revisedContent.length > 1200
            ? revisedContent.slice(0, 1200) +
              "\n\n... (truncated, see full file)"
            : revisedContent;
      }

      const content =
        revisedPath && existsSync(revisedPath)
          ? `Session: \`${session.sessionName}\` · Duration: ${minutes}m ${seconds}s\n\n` +
            `📄 **Original** + 🦙 **Revised** (chunking, embedding, summary)\n\n` +
            `**Preview (Revised):**\n\`\`\`\n${revisedPreview}\n\`\`\``
          : `Session: \`${session.sessionName}\`\n\n` +
            `⚠️ Ollama processing failed, original transcript attached.`;

      const summaryMsg = summary
        ? `📋 **Riassunto** – \`${session.sessionName}\`\n\n${summary.length > 1950 ? summary.slice(0, 1950) + "\n..." : summary}`
        : null;

      const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
      const summaryChannelName = config.discord?.summaryChannelName ?? "riassunti";

      const sentToSummary = guild && (await sendToSummaryChannel(
        guild,
        summaryChannelName,
        content.slice(0, 1900),
        files,
        summaryMsg,
      ));

      if (sentToSummary) {
        await interaction.editReply({
          content: `✅ **Transcription complete!** Session: \`${session.sessionName}\`\n📎 Trascrizione e riassunto inviati in **#${summaryChannelName}**.`,
        });
      } else {
        try {
          await sendInThread(
            interaction,
            session.sessionName,
            content.slice(0, 1900),
            files,
            summaryMsg,
          );
        } catch (threadErr) {
          const code = threadErr.code ?? threadErr.body?.code;
          console.warn(
            "[Stop] Thread creation failed, falling back to channel:",
            code ? `[${code}] ${threadErr.message}` : threadErr.message,
          );
          if (code === 50013) {
            console.warn(
              "[Stop] Hint: enable 'Create Public Threads' for the bot in this channel/server.",
            );
          }
          await replyOrSendToChannel(interaction, {
            content,
            files,
            isEdit: true,
          });
          if (summaryMsg) {
            await replyOrSendToChannel(interaction, {
              content: summaryMsg,
              isEdit: false,
            });
          }
        }
      }
    } else {
      await replyOrSendToChannel(interaction, {
        content:
          `⚠️ **Recording saved but transcription failed**\n` +
          `Session: \`${session.sessionName}\`\n` +
          `Audio file: \`${audioFilePath}\`\n\n` +
          `You can manually transcribe the audio file later.`,
        isEdit: true,
      });
    }
  } catch (error) {
    console.error("[Stop] Error:", error);
    try {
      await replyOrSendToChannel(interaction, {
        content: "An error occurred while processing the recording.",
        isEdit: true,
      });
    } catch (e) {
      if (interaction.channel) {
        await interaction.channel.send(
          "An error occurred while processing the recording.",
        );
      }
    }
  }
}
