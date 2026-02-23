import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Collection to store commands
client.commands = new Collection();

// Store active recording sessions
client.recordingSessions = new Map();

// Load commands
async function loadCommands() {
  const commandsPath = join(__dirname, 'commands');
  const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(filePath);

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`[Commands] Loaded: ${command.data.name}`);
    } else {
      console.warn(`[Warning] Command at ${filePath} is missing required "data" or "execute" property.`);
    }
  }
}

// Handle slash command interactions
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`[Error] No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`[Error] Error executing ${interaction.commandName}:`, error);

    const errorMessage = {
      content: 'There was an error executing this command!',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

// Bot ready event
client.once(Events.ClientReady, readyClient => {
  console.log(`[Ready] Logged in as ${readyClient.user.tag}`);
  console.log(`[Ready] Serving ${readyClient.guilds.cache.size} guild(s)`);
});

// Error handling
client.on(Events.Error, error => {
  console.error('[Discord Error]', error);
});

process.on('unhandledRejection', error => {
  console.error('[Unhandled Rejection]', error);
});

// Initialize and start the bot
async function main() {
  try {
    await loadCommands();
    await client.login(config.discord.token);
  } catch (error) {
    console.error('[Fatal] Failed to start bot:', error);
    process.exit(1);
  }
}

main();
