import { REST, Routes } from 'discord.js';
import { config, validateConfig } from './config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Sanity check config
if (!validateConfig()) {
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

// Read all command files
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('🔍 Loading command files for deployment...');
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  // Using file:/// protocol for dynamic import on Windows
  const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
  const { default: command } = await import(fileUrl);
  
  if (command && command.data) {
    commands.push(command.data.toJSON());
    console.log(`- Loaded: ${command.data.name}`);
  } else {
    console.warn(`⚠️ Warning: Command file at ${file} is missing required data properties.`);
  }
}

// 2. Initialize REST client
const rest = new REST({ version: '10' }).setToken(config.discord.token);

// 3. Deploy commands globally
(async () => {
  try {
    console.log(`\n🚀 Starting deployment of ${commands.length} application (/) commands...`);

    // Register globally
    const data = await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands }
    );

    console.log(`\n✅ Successfully registered ${data.length} global application (/) commands!`);
    console.log('Note: Global commands can take a few seconds to update across all servers.');
  } catch (error) {
    console.error('❌ Error deploying slash commands:', error);
  }
})();
