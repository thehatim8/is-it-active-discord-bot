import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { formatDuration, formatHour, timeframeToDays, formatTimeframeLabel } from '../utils/formatters.js';
import { sparkline } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';
import {
  getChannelLabel,
  getGuildMemberIds,
  getReadableGuildTextChannelIds,
  getReadableGuildVoiceChannelIds,
  refreshGuildChannels,
  resolveMemberLabels
} from '../utils/discordLabels.js';

const COMPARISON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getPreviousPeriodWindow(days) {
  const end = new Date(Date.now() - days * MS_PER_DAY);
  const start = new Date(end.getTime() - days * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getCurrentPeriodWindow(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * MS_PER_DAY);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getActivityScore(summary) {
  if (!summary) return 0;
  return (Number(summary.total_messages) * 10) + Math.floor((Number(summary.total_voice_seconds) / 60) * 5);
}

function formatPercentChange(current, previous) {
  if (previous === 0 && current === 0) return '0.0%';
  if (previous === 0) return 'new activity';

  const percent = ((current - previous) / previous) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function formatComparisonLine(label, current, previous, formatter = value => value.toLocaleString()) {
  return `**${label}:** \`${formatter(current)}\` vs \`${formatter(previous)}\` (${formatPercentChange(current, previous)})`;
}

function formatSignedNumber(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatRetention(value) {
  return value === null || value === undefined ? 'Not enough join data' : `${value.toFixed(1)}%`;
}

function formatBestGrowthWindow(growth) {
  if (!growth?.best_growth_date) {
    return 'No growth events recorded in this timeframe.';
  }

  return `${growth.best_growth_date} at ${formatHour(growth.best_growth_hour)} UTC (\`${formatSignedNumber(growth.best_growth_net)}\` net, \`${growth.best_growth_joins}\` joins, \`${growth.best_growth_leaves}\` leaves)`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('analytics-dashboard')
    .setDescription('Displays a beautiful, complete analytics dashboard for the server.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period to view analytics for.')
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
    const guildName = guild.name;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
      return interaction.editReply({ content: 'I could not verify my server permissions. Please try again in a moment.' });
    }

    await refreshGuildChannels(guild);

    const textChannelIds = getReadableGuildTextChannelIds(guild, botMember);
    const voiceChannelIds = getReadableGuildVoiceChannelIds(guild, botMember);

    // 1. Fetch dashboard stats
    const [
      summary,
      hourlyData,
      activeTextChannels,
      activeVoiceChannels,
      currentComparison,
      previousComparison,
      growth
    ] = await Promise.all([
      db.getServerHealthSummaryForIds(guildId, { textChannelIds, voiceChannelIds, days }),
      db.getHourlyPeakAnalysisForIds(guildId, textChannelIds, voiceChannelIds, days),
      db.getActiveChannelsForIds(guildId, textChannelIds, days, Math.max(textChannelIds.length, 15)),
      db.getActiveVoiceChannelsForIds(guildId, voiceChannelIds, days),
      db.getServerHealthSummaryForIds(guildId, {
        textChannelIds,
        voiceChannelIds,
        ...getCurrentPeriodWindow(COMPARISON_DAYS)
      }),
      db.getServerHealthSummaryForIds(guildId, {
        textChannelIds,
        voiceChannelIds,
        ...getPreviousPeriodWindow(COMPARISON_DAYS)
      }),
      db.getGrowthAnalytics(guildId, days)
    ]);

    let activeMembers = await db.getActiveMembersLeaderboard(guildId, 'combined', days);
    let memberLabels = await resolveMemberLabels(guild, activeMembers.map(row => row.user_id));
    let visibleMembers = activeMembers.filter(row => memberLabels.has(String(row.user_id)));

    if (visibleMembers.length !== activeMembers.length) {
      const memberIds = await getGuildMemberIds(guild);
      activeMembers = await db.getActiveMembersLeaderboardForIds(guildId, 'combined', days, memberIds);
      memberLabels = await resolveMemberLabels(guild, activeMembers.map(row => row.user_id));
      visibleMembers = activeMembers.filter(row => memberLabels.has(String(row.user_id)));
    }

    const hasGrowthActivity = Number(growth?.joins || 0) > 0 || Number(growth?.leaves || 0) > 0;

    if (!summary || (Number(summary.total_messages) === 0 && Number(summary.total_voice_seconds) === 0 && !hasGrowthActivity)) {
      const emptyEmbed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('📊 Analytics Dashboard')
        .setDescription(`No analytics data found for **${guildName}** in the **${formatTimeframeLabel(timeframe)}** timeframe.\n\n*Tip: Ask an administrator to run \`/backfill\` to populate historical data!*`)
        .setFooter({ text: 'Is It Active? • Server Analytics', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();
      return interaction.editReply({ embeds: [emptyEmbed] });
    }

    // 2. Extract message volume list for the sparkline
    const messageHours = hourlyData.map(h => parseInt(h.message_count || 0));
    const activeSparkline = sparkline(messageHours);
    const averageDays = days === 0 ? 30 : days;
    const topTextChannel = activeTextChannels[0] || null;
    const topVoiceChannel = activeVoiceChannels[0] || null;
    const topMember = visibleMembers[0] || null;
    const messageCountsByChannel = new Map(activeTextChannels.map(row => [String(row.channel_id), Number(row.message_count)]));
    const quietestChannel = textChannelIds
      .map(channelId => ({
        channel_id: channelId,
        message_count: messageCountsByChannel.get(String(channelId)) || 0
      }))
      .sort((a, b) => a.message_count - b.message_count)[0] || null;

    const healthSummary = [
      `**Most Active Text:** ${topTextChannel ? `${getChannelLabel(guild, topTextChannel.channel_id)} (\`${Number(topTextChannel.message_count).toLocaleString()}\` msgs)` : 'No text activity'}`,
      `**Most Active Voice:** ${topVoiceChannel ? `${getChannelLabel(guild, topVoiceChannel.channel_id)} (\`${formatDuration(Number(topVoiceChannel.total_seconds))}\`)` : 'No voice activity'}`,
      `**Most Active Member:** ${topMember ? `${memberLabels.get(String(topMember.user_id))} (\`${Number(topMember.score).toLocaleString()}\` pts)` : 'No member activity'}`,
      `**Quietest Channel:** ${quietestChannel ? `${getChannelLabel(guild, quietestChannel.channel_id)} (\`${Number(quietestChannel.message_count).toLocaleString()}\` msgs)` : 'No readable text channels'}`
    ].join('\n');

    const activityChange = [
      formatComparisonLine('Activity Score', getActivityScore(currentComparison), getActivityScore(previousComparison)),
      formatComparisonLine('Messages', Number(currentComparison?.total_messages || 0), Number(previousComparison?.total_messages || 0)),
      formatComparisonLine(
        'Voice Time',
        Number(currentComparison?.total_voice_seconds || 0),
        Number(previousComparison?.total_voice_seconds || 0),
        value => formatDuration(value)
      )
    ].join('\n');

    const growthAnalytics = [
      `**Joins:** \`${Number(growth.joins).toLocaleString()}\``,
      `**Leaves:** \`${Number(growth.leaves).toLocaleString()}\``,
      `**Net Growth:** \`${formatSignedNumber(Number(growth.net_growth))}\``,
      `**Retention Estimate:** \`${formatRetention(growth.retention_estimate)}\``,
      `**Best Growth Day/Time:** ${formatBestGrowthWindow(growth)}`
    ].join('\n');

    // 3. Build premium UI Embed
    const dashboardEmbed = new EmbedBuilder()
      .setColor('#10B981') // Premium Supabase Emerald green
      .setTitle(`📊 Server Analytics Dashboard — ${guildName}`)
      .setDescription(`Detailed activity overview for the server during the **${formatTimeframeLabel(timeframe)}**.`)
      .addFields(
        { 
          name: '💬 Text Activity', 
          value: `**Total Messages:** \`${Number(summary.total_messages).toLocaleString()}\`\n**Avg/Hour:** \`${(Number(summary.total_messages) / averageDays / 24).toFixed(1)}\``, 
          inline: true 
        },
        { 
          name: '🔊 Voice Activity', 
          value: `**Total Time:** \`${formatDuration(Number(summary.total_voice_seconds))}\`\n**Hours Spent:** \`${(Number(summary.total_voice_seconds) / 3600).toFixed(1)} hrs\``, 
          inline: true 
        },
        { 
          name: '👥 Active Members', 
          value: `**Total Active:** \`${Number(summary.active_users).toLocaleString()}\`\n**Server Size:** \`${guild.memberCount.toLocaleString()}\``, 
          inline: true 
        },
        {
          name: 'Server Health Summary',
          value: healthSummary,
          inline: false
        },
        {
          name: 'Server Growth Analytics',
          value: growthAnalytics,
          inline: false
        },
        {
          name: `Activity Change: Last ${COMPARISON_DAYS} Days vs Previous ${COMPARISON_DAYS} Days`,
          value: activityChange,
          inline: false
        },
        {
          name: '📈 24-Hour Trend Sparkline',
          value: `\`${activeSparkline}\` *(00:00 to 23:00 UTC)*`,
          inline: false
        },
        { 
          name: '🔥 Peak Server Hour', 
          value: `\`${formatHour(summary.server_peak_hour)}\` *(Server activity spikes at this hour)*`, 
          inline: false 
        }
      )
      .setFooter({ text: 'Is It Active? • Premium Analytics', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [dashboardEmbed] });
  }
};
