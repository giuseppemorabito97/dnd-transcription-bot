import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

async function deployCommands() {
  // Load all commands
  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);

    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
      console.log(`[Deploy] Found command: ${command.data.name}`);
    }
  }

  const rest = new REST().setToken(config.discord.token);

  try {
    console.log(`[Deploy] Started refreshing ${commands.length} application (/) commands.`);

    let data;

    if (config.discord.guildId) {
      // Deploy to specific guild (faster for development)
      data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );
      console.log(`[Deploy] Successfully deployed ${data.length} commands to guild ${config.discord.guildId}`);
    } else {
      // Deploy globally (takes up to 1 hour to propagate)
      data = await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
      console.log(`[Deploy] Successfully deployed ${data.length} commands globally`);
    }
  } catch (error) {
    console.error('[Deploy] Error:', error);
  }
}

deployCommands();
