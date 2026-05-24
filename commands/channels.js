import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { timeframeToDays, formatTimeframeLabel, formatHour } from '../utils/formatters.js';
import { progressBar } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';
import {
  getChannelLabel,
  getReadableGuildTextChannelIds,
  getReadableGuildVoiceChannelIds,
  refreshGuildChannels
} from '../utils/discordLabels.js';

const COMPARISON_DAYS = 7;
const LOW_TRAFFIC_30_DAY_THRESHOLD = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getPreviousPeriodWindow(days) {
  const end = new Date(Date.now() - days * MS_PER_DAY);
  const start = new Date(end.getTime() - days * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getActivityScore(summary) {
  if (!summary) return 0;
  return (Number(summary.total_messages) * 10) + Math.floor((Number(summary.total_voice_seconds) / 60) * 5);
}

function formatTrendSentence(subject, verb, current, previous) {
  if (current === 0 && previous === 0) {
    return `${subject} stayed quiet compared with last week.`;
  }

  if (previous === 0) {
    return `${subject} started this week.`;
  }

  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.1) {
    return `${subject} stayed flat compared with last week.`;
  }

  const direction = change > 0 ? `${verb} up` : 'dropped';
  return `${subject} ${direction} **${Math.abs(change).toFixed(1)}%** from last week.`;
}

function formatPeakShift(currentSummary, previousSummary) {
  if (getActivityScore(currentSummary) === 0 && getActivityScore(previousSummary) === 0) {
    return 'Peak hour has no comparable activity yet.';
  }

  const currentHour = Number(currentSummary?.server_peak_hour || 0);
  const previousHour = Number(previousSummary?.server_peak_hour || 0);

  if (currentHour === previousHour) {
    return `Peak hour stayed at **${formatHour(currentHour)}**.`;
  }

  return `Peak hour shifted from **${formatHour(previousHour)}** to **${formatHour(currentHour)}**.`;
}

function formatChannelList(guild, rows, emptyText) {
  if (rows.length === 0) return emptyText;

  const visibleRows = rows.slice(0, 5);
  const hiddenCount = rows.length - visibleRows.length;
  const visibleText = visibleRows
    .map(row => `${getChannelLabel(guild, row.channel_id) || 'Unknown channel'} (\`${row.message_count}\`)`)
    .join(', ');

  return hiddenCount > 0 ? `${visibleText}, +${hiddenCount} more` : visibleText;
}

export default {
  data: new SlashCommandBuilder()
    .setName('active-channels')
    .setDescription('Ranks text channels by their activity levels.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period to analyze channel activity.')
        .setRequired(false)
        .addChoices(
          { name: 'Last 24 Hours', value: '24h' },
          { name: 'Last 7 Days', value: '7d' },
          { name: 'Last 30 Days', value: '30d' },
          { name: 'All Time', value: 'all_time' }
        )),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = await requireGuild(interaction);
    if (!guild) return;

    const timeframe = interaction.options.getString('timeframe') || '7d';
    const days = timeframeToDays(timeframe);
    const guildId = guild.id;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
      return interaction.editReply({ content: 'I could not verify my server permissions. Please try again in a moment.' });
    }

    await refreshGuildChannels(guild);

    const channelIds = getReadableGuildTextChannelIds(guild, botMember);
    const voiceChannelIds = getReadableGuildVoiceChannelIds(guild, botMember);

    if (channelIds.length === 0) {
      return interaction.editReply({ content: 'No readable text channels found in this server.' });
    }

    const [
      channels,
      currentSummary,
      previousSummary,
      channels7d,
      channels30d
    ] = await Promise.all([
      db.getActiveChannelsForIds(guildId, channelIds, days),
      db.getServerHealthSummaryForIds(guildId, { textChannelIds: channelIds, voiceChannelIds, days: COMPARISON_DAYS }),
      db.getServerHealthSummaryForIds(guildId, {
        textChannelIds: channelIds,
        voiceChannelIds,
        ...getPreviousPeriodWindow(COMPARISON_DAYS)
      }),
      db.getActiveChannelsForIds(guildId, channelIds, 7, Math.max(channelIds.length, 15)),
      db.getActiveChannelsForIds(guildId, channelIds, 30, Math.max(channelIds.length, 15))
    ]);

    const maxCount = channels.length > 0 ? Number(channels[0].message_count) : 0;
    const leaderboardText = channels.length > 0
      ? channels.map((row, index) => {
        const rankEmoji = `\`#${index + 1}\``;
        const messageCount = Number(row.message_count);
        const fraction = maxCount > 0 ? messageCount / maxCount : 0;
        const bar = progressBar(fraction, 8);
        const peakHourFormatted = formatHour(row.peak_hour);
        const channelLabel = getChannelLabel(guild, row.channel_id) || 'Unknown channel';

        return `${rankEmoji} **${channelLabel}** - **${messageCount.toLocaleString()}** messages\n\`  \` ${bar} \`${Math.round(fraction * 100)}%\` | Peak Hour: \`${peakHourFormatted}\``;
      }).join('\n\n')
      : 'No text channel activity recorded for this timeframe.';

    const countBy7d = new Map(channels7d.map(row => [String(row.channel_id), Number(row.message_count)]));
    const countBy30d = new Map(channels30d.map(row => [String(row.channel_id), Number(row.message_count)]));

    const noMessages7d = channelIds
      .filter(channelId => !countBy7d.has(String(channelId)))
      .map(channelId => ({ channel_id: channelId, message_count: 0 }));

    const noMessages30d = channelIds
      .filter(channelId => !countBy30d.has(String(channelId)))
      .map(channelId => ({ channel_id: channelId, message_count: 0 }));

    const lowTraffic30d = channelIds
      .map(channelId => ({ channel_id: channelId, message_count: countBy30d.get(String(channelId)) || 0 }))
      .filter(row => row.message_count > 0 && row.message_count < LOW_TRAFFIC_30_DAY_THRESHOLD)
      .sort((a, b) => a.message_count - b.message_count);

    const trendText = [
      formatTrendSentence('Messages', 'are', Number(currentSummary?.total_messages || 0), Number(previousSummary?.total_messages || 0)),
      formatTrendSentence('Voice activity', 'is', Number(currentSummary?.total_voice_seconds || 0), Number(previousSummary?.total_voice_seconds || 0)),
      formatPeakShift(currentSummary, previousSummary)
    ].join('\n');

    const inactiveText = [
      `**No messages in 7 days:** ${formatChannelList(guild, noMessages7d, 'None')}`,
      `**No messages in 30 days:** ${formatChannelList(guild, noMessages30d, 'None')}`,
      `**Low traffic under ${LOW_TRAFFIC_30_DAY_THRESHOLD} msgs/30d:** ${formatChannelList(guild, lowTraffic30d, 'None')}`
    ].join('\n');

    const channelsEmbed = new EmbedBuilder()
      .setColor('#34D399')
      .setTitle(`Active Text Channels - ${guild.name}`)
      .setDescription(`Ranks of text channels by message count during the **${formatTimeframeLabel(timeframe)}**.\n\n${leaderboardText}`)
      .addFields(
        {
          name: `Trend Comparisons: Last ${COMPARISON_DAYS} Days vs Previous ${COMPARISON_DAYS} Days`,
          value: trendText,
          inline: false
        },
        {
          name: 'Inactive Channel Detection',
          value: inactiveText,
          inline: false
        }
      )
      .setFooter({ text: 'Is It Active? - Channels Ranking', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [channelsEmbed] });
  }
};
