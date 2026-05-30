import { Client, GatewayIntentBits, Collection, ActivityType, PermissionFlagsBits } from 'discord.js';
import { config, validateConfig } from './config.js';
import { db } from './database.js';
import {
  KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS,
  formatKickDeafenDuration,
  isVoiceStateDeafened
} from './utils/kickDeafen.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Sanity check environment config
if (!validateConfig()) {
  process.exit(1);
}

// 2. Initialize Discord Client with necessary Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Privileged intent for text analytics
    GatewayIntentBits.GuildVoiceStates, // Required for voice chat duration logging
    GatewayIntentBits.GuildMembers, // Privileged intent for growth analytics
  ]
});

// Create command collection
client.commands = new Collection();

const kickDeafenTimers = new Map();
const kickDeafenSettingsCache = new Map();

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
}

async function commandAccessAllowed(interaction) {
  if (!interaction.inGuild()) {
    return false;
  }

  if (isAdministrator(interaction)) {
    return true;
  }

  if (interaction.commandName === 'bot-access') {
    return false;
  }

  const rules = await db.getCommandAccessRules(interaction.guildId);
  if (rules.length === 0) {
    return false;
  }

  const memberAllowed = rules.some(rule =>
    rule.target_type === 'member' && rule.target_id === interaction.user.id
  );
  if (memberAllowed) {
    return true;
  }

  const roleIds = rules
    .filter(rule => rule.target_type === 'role')
    .map(rule => rule.target_id);

  if (roleIds.length === 0) {
    return false;
  }

  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

  if (!member?.roles?.cache) {
    return false;
  }

  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function getKickDeafenTimerKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function clearKickDeafenTimer(guildId, userId) {
  const key = getKickDeafenTimerKey(guildId, userId);
  const pending = kickDeafenTimers.get(key);
  if (!pending) return;

  clearTimeout(pending.timeout);
  kickDeafenTimers.delete(key);
}

function clearKickDeafenGuildTimers(guildId) {
  for (const key of kickDeafenTimers.keys()) {
    if (key.startsWith(`${guildId}:`)) {
      clearTimeout(kickDeafenTimers.get(key).timeout);
      kickDeafenTimers.delete(key);
    }
  }
}

async function getKickDeafenSettings(guildId, { force = false } = {}) {
  if (!force && kickDeafenSettingsCache.has(guildId)) {
    return kickDeafenSettingsCache.get(guildId);
  }

  const settings = await db.getKickDeafenSettings(guildId);
  kickDeafenSettingsCache.set(guildId, settings);
  return settings;
}

function scheduleKickDeafenDisconnect(voiceState, settings, { reset = false } = {}) {
  const guild = voiceState.guild;
  const userId = voiceState.id;
  const key = getKickDeafenTimerKey(guild.id, userId);

  if (kickDeafenTimers.has(key) && !reset) {
    return;
  }

  clearKickDeafenTimer(guild.id, userId);

  const inactivitySeconds = Number(settings.inactivitySeconds);
  const delaySeconds = Number.isFinite(inactivitySeconds) && inactivitySeconds > 0
    ? inactivitySeconds
    : KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS;
  const delayMs = Math.max(1000, delaySeconds * 1000);
  const timeout = setTimeout(async () => {
    kickDeafenTimers.delete(key);

    try {
      const currentSettings = await getKickDeafenSettings(guild.id);
      if (!currentSettings.enabled) return;

      const currentState = guild.voiceStates.cache.get(userId);
      if (!currentState?.channelId || !isVoiceStateDeafened(currentState) || currentState.member?.user.bot) {
        return;
      }

      if (!currentState.member?.voice?.disconnect) {
        return;
      }

      const reason = `Stayed deafened for ${formatKickDeafenDuration(currentSettings.inactivitySeconds)}.`;
      await currentState.member.voice.disconnect(reason);
    } catch (err) {
      console.error(`Failed to disconnect deafened user ${userId} in guild ${guild.id}:`, err.message);
    }
  }, delayMs);

  kickDeafenTimers.set(key, { timeout });
}

async function evaluateKickDeafenState(voiceState) {
  if (!voiceState?.guild || voiceState.member?.user.bot) return;

  if (!voiceState.channelId || !isVoiceStateDeafened(voiceState)) {
    clearKickDeafenTimer(voiceState.guild.id, voiceState.id);
    return;
  }

  const settings = await getKickDeafenSettings(voiceState.guild.id);
  if (!settings.enabled) {
    clearKickDeafenTimer(voiceState.guild.id, voiceState.id);
    return;
  }

  scheduleKickDeafenDisconnect(voiceState, settings);
}

async function refreshKickDeafenGuild(guild) {
  const settings = await getKickDeafenSettings(guild.id, { force: true });

  if (!settings.enabled) {
    clearKickDeafenGuildTimers(guild.id);
    return settings;
  }

  for (const voiceState of guild.voiceStates.cache.values()) {
    if (voiceState.channelId && !voiceState.member?.user.bot && isVoiceStateDeafened(voiceState)) {
      scheduleKickDeafenDisconnect(voiceState, settings, { reset: true });
    } else {
      clearKickDeafenTimer(guild.id, voiceState.id);
    }
  }

  return settings;
}

client.refreshKickDeafenGuild = refreshKickDeafenGuild;

// 3. Load Commands Dynamically
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('🤖 Loading slash command handlers...');
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
  const { default: command } = await import(fileUrl);
  
  if (command && command.data) {
    client.commands.set(command.data.name, command);
    console.log(`- Command registered: /${command.data.name}`);
  }
}

// ==================================================================
// Discord Gateway Events
// ==================================================================

// READY Event: Synchronizes and logs bot presence
client.once('ready', async () => {
  console.log(`\n✅ Success! Logged in as ${client.user.tag}`);
  
  // Set gorgeous gaming presence activity
  client.user.setActivity({
    name: 'server activity 📊',
    type: ActivityType.Watching
  });

  // Self-healing startup routine: Synchronize voice states for all active servers
  for (const guild of client.guilds.cache.values()) {
    try {
      await db.upsertGuild(guild);

      const activeStates = [];
      guild.voiceStates.cache.forEach(vs => {
        // Log all non-bot users currently in active voice channels
        if (vs.channelId && vs.member && !vs.member.user.bot) {
          activeStates.push({
            guildId: guild.id,
            channelId: vs.channelId,
            userId: vs.id
          });
        }
      });
      await db.syncActiveVoiceStates(guild.id, activeStates);
      await refreshKickDeafenGuild(guild);
    } catch (err) {
      console.error(`Failed to synchronize voice states for guild ${guild.name}:`, err.message);
    }
  }
});

// MESSAGE CREATE Event: Logs text message activity
client.on('messageCreate', async message => {
  // Ignore bots and DM messages
  if (message.author.bot || !message.guild) return;
  
  await db.logMessage(message.guildId, message.channelId, message.author.id);
});

// VOICE STATE UPDATE Event: Tracks voice presence sessions
client.on('voiceStateUpdate', async (oldState, newState) => {
  // Ignore bot voice channel updates
  if (newState.member?.user.bot) return;

  const guildId = newState.guild.id;
  const userId = newState.id;

  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  // Case 1: User Joined voice channel
  if (oldChannelId === null && newChannelId !== null) {
    await db.startVoiceSession(guildId, newChannelId, userId);
  }
  // Case 2: User Left voice channel
  else if (oldChannelId !== null && newChannelId === null) {
    await db.endVoiceSession(guildId, userId);
  }
  // Case 3: User Switched voice channels
  else if (oldChannelId !== null && newChannelId !== null && oldChannelId !== newChannelId) {
    await db.startVoiceSession(guildId, newChannelId, userId);
  }

  await evaluateKickDeafenState(newState);
});

// GUILD MEMBER ADD Event: Logs growth joins
client.on('guildMemberAdd', async member => {
  if (member.user.bot) return;
  await db.logMemberEvent(member.guild.id, member.id, 'join');
});

// GUILD MEMBER REMOVE Event: Logs growth leaves
client.on('guildMemberRemove', async member => {
  if (member.user.bot) return;
  await db.logMemberEvent(member.guild.id, member.id, 'leave');
});

// GUILD CREATE Event: Makes the web dashboard aware of newly connected servers
client.on('guildCreate', async guild => {
  await db.upsertGuild(guild);
});

// GUILD DELETE Event: Keeps the web dashboard from showing disconnected servers
client.on('guildDelete', async guild => {
  clearKickDeafenGuildTimers(guild.id);
  kickDeafenSettingsCache.delete(guild.id);
  await db.markGuildUnavailable(guild.id);
});

// INTERACTION CREATE Event: Slash commands entry router
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    const allowed = await commandAccessAllowed(interaction);
    if (!allowed) {
      return interaction.reply({
        content: 'You do not have permission to use this bot. Ask a server administrator to add your role or account with `/bot-access`.',
        ephemeral: true
      }).catch(() => {});
    }

    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command /${interaction.commandName}:`, error);
    
    const errMsg = '❌ There was an error while executing this command!';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errMsg, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => {});
    }
  }
});

// 4. Log in the bot
client.login(config.discord.token).catch(err => {
  console.error('\n❌ LOGIN ERROR: Failed to log in to Discord. Please check your DISCORD_TOKEN in .env!\n', err);
});
