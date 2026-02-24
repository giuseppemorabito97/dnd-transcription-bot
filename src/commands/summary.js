import { SlashCommandBuilder } from "discord.js";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import config from "../config.js";
import { summarizeTranscriptFile } from "../transcription/ollamaProcessor.js";

export const data = new SlashCommandBuilder()
  .setName("summary")
  .setDescription("Genera un riassunto da una trascrizione esistente")
  .addStringOption((option) =>
    option
      .setName("session")
      .setDescription("Nome sessione (es. session_2026-02-24T01-28-10-478Z)")
      .setRequired(true),
  );

export async function execute(interaction) {
  const sessionName = interaction.options.getString("session");

  await interaction.deferReply();

  const originalPath = join(config.paths.transcripts, `${sessionName}.txt`);
  const revisedPath = join(
    config.paths.transcriptsRevised,
    `${sessionName}_revised.txt`,
  );

  let transcriptPath;
  let sourceLabel;

  // cosa fa?
  // se il file revised esiste, lo usa
  // se il file original esiste, lo usa
  // se nessuno dei due esiste, mostra un errore
  if (existsSync(revisedPath)) {
    transcriptPath = revisedPath;
    sourceLabel = "revised";
  } else if (existsSync(originalPath)) {
    transcriptPath = originalPath;
    sourceLabel = "original";
  } else {
    await interaction.editReply({
      content:
        `❌ Nessuna trascrizione trovata per la sessione \`${sessionName}\`.\n` +
        `Controlla che esista \`${sessionName}.txt\` in \`transcripts/\` o \`${sessionName}_revised.txt\` in \`transcripts-revised/\`.`,
    });
    return;
  }

  await interaction.editReply(
    `🔄 Genero il riassunto per \`${sessionName}\` (sorgente: ${sourceLabel})...`,
  );

  let masterUsername;
  try {
    const metaPath = join(config.paths.transcriptsRevised, `${sessionName}_meta.json`);
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, "utf-8"));
      masterUsername = meta.masterUsername || undefined;
    }
  } catch (_) {}

  try {
    const { summary } = await summarizeTranscriptFile(
      transcriptPath,
      sessionName,
      { masterUsername },
    );

    if (!summary) {
      await interaction.editReply(
        `⚠️ Non sono riuscito a generare il riassunto per \`${sessionName}\`.`,
      );
      return;
    }

    const header =
      `📋 **Riassunto generato per** \`${sessionName}\` (sorgente: ${sourceLabel})\n\n`;
    const maxChunk = 2000;
    const firstChunkMax = maxChunk - header.length;
    const chunks = [];
    let remaining = summary;
    while (remaining.length > 0) {
      const limit = chunks.length === 0 ? firstChunkMax : maxChunk;
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }
      chunks.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    await interaction.editReply({ content: header + chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i] });
    }
  } catch (error) {
    console.error("[Summary] Error:", error);
    await interaction.editReply(
      "⚠️ Errore durante la generazione del riassunto.",
    );
  }
}
