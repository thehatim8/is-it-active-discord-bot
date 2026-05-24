import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { progressBar } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';

const DISCORD_MESSAGE_FETCH_LIMIT = 100;
const DB_INSERT_CHUNK_SIZE = 100;

async function fetchHistoricalMessages(channel, targetLimit) {
  const messages = [];
  let before;

  while (messages.length < targetLimit) {
    const remaining = targetLimit - messages.length;
    const limit = Math.min(DISCORD_MESSAGE_FETCH_LIMIT, remaining);
    const options = { limit, cache: false };

    if (before) {
      options.before = before;
    }

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) {
      break;
    }

    const batch = Array.from(fetched.values());
    messages.push(...batch);
    before = batch[batch.length - 1].id;

    if (fetched.size < limit) {
      break;
    }
  }

  return messages;
}

export default {
  data: new SlashCommandBuilder()
    .setName('backfill')
    .setDescription('Scans channel message history to populate the database with retroactive analytics.')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of historical messages to fetch per channel (default: 100, max: 500).')
        .setRequired(false)
        .addChoices(
          { name: '100 Messages', value: 100 },
          { name: '250 Messages', value: 250 },
          { name: '500 Messages', value: 500 }
        )),

  async execute(interaction) {
    await interaction.deferReply();

    const limit = interaction.options.getInteger('limit') || 100;
    const guild = await requireGuild(interaction);
    if (!guild) return;

    const guildId = guild.id;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
      return interaction.editReply({ content: '❌ I could not verify my server permissions. Please try again in a moment.' });
    }

    await guild.channels.fetch().catch(err => {
      console.error(`Failed to refresh channels for guild ${guild.name}:`, err.message);
    });

    // 1. Fetch all text channels in the guild
    const channels = Array.from(guild.channels.cache.values()).filter(
      c => c?.type === ChannelType.GuildText &&
           c.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    );

    if (channels.length === 0) {
      return interaction.editReply({ content: '❌ No readable text channels found in this server!' });
    }

    const progressEmbed = new EmbedBuilder()
      .setColor('#3B82F6') // Blue
      .setTitle('🔄 Database Backfill in Progress')
      .setDescription(`Scanning historical messages. This may take a few moments...\n\n${progressBar(0, 12)} \`0%\``)
      .setFooter({ text: 'Is It Active? • System Administration' })
      .setTimestamp();

    await interaction.editReply({ embeds: [progressEmbed] });

    let totalMessagesFetched = 0;
    let totalMessagesLogged = 0;
    let skippedBotMessages = 0;
    let failedChannels = 0;
    let processedCount = 0;

    for (const channel of channels) {
      try {
        const fetchedMessages = await fetchHistoricalMessages(channel, limit);
        const messagesToLog = [];

        totalMessagesFetched += fetchedMessages.length;

        for (const msg of fetchedMessages) {
          if (msg.author.bot) {
            skippedBotMessages++;
            continue;
          }

          messagesToLog.push({
            guild_id: guildId,
            channel_id: channel.id,
            user_id: msg.author.id,
            created_at: new Date(msg.createdTimestamp).toISOString()
          });
        }

        // Chunk insert in groups of 100 to optimize Supabase payload
        for (let i = 0; i < messagesToLog.length; i += DB_INSERT_CHUNK_SIZE) {
          const chunk = messagesToLog.slice(i, i + DB_INSERT_CHUNK_SIZE);
          totalMessagesLogged += await db.logMessagesBatch(chunk);
        }
      } catch (err) {
        failedChannels++;
        console.error(`Skipping channel #${channel.name} due to fetch error:`, err.message);
      }

      processedCount++;
      
      // Update progress every 2 channels (to stay safe from Discord rate limits)
      if (processedCount % 2 === 0 || processedCount === channels.length) {
        const fraction = processedCount / channels.length;
        const progressEmbedUpdate = new EmbedBuilder()
          .setColor('#3B82F6')
          .setTitle('🔄 Database Backfill in Progress')
          .setDescription(`Scanning <#${channel.id}> (${processedCount}/${channels.length} channels)\n\n${progressBar(fraction, 12)} \`${Math.round(fraction * 100)}%\` complete\n\n**Messages Fetched:** \`${totalMessagesFetched}\`\n**Messages Logged:** \`${totalMessagesLogged}\``)
          .setFooter({ text: 'Is It Active? • System Administration' })
          .setTimestamp();
          
        await interaction.editReply({ embeds: [progressEmbedUpdate] }).catch(() => {});
      }
    }

    // Done!
    const doneEmbed = new EmbedBuilder()
      .setColor('#10B981') // Green
      .setTitle('✅ Database Backfill Complete')
      .setDescription(`Successfully scanned all accessible text channels and pre-populated the analytics database!`)
      .addFields(
        { name: '📺 Channels Scanned', value: `\`${channels.length}\` text channels`, inline: true },
        { name: 'Messages Fetched', value: `\`${totalMessagesFetched}\` messages`, inline: true },
        { name: 'Messages Logged', value: `\`${totalMessagesLogged}\` messages`, inline: true },
        { name: 'Bot Messages Skipped', value: `\`${skippedBotMessages}\` messages`, inline: true },
        { name: 'Channels Failed', value: `\`${failedChannels}\` channels`, inline: true }
      )
      .setFooter({ text: 'Is It Active? • Backfill Complete', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [doneEmbed] });
  }
};
