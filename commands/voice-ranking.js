import { SlashCommandBuilder, EmbedBuilder, ChannelType, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { formatDuration, timeframeToDays, formatTimeframeLabel } from '../utils/formatters.js';
import { progressBar } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';
import { getGuildMemberIds, resolveMemberLabels } from '../utils/discordLabels.js';

// Instantiate another client specifically for custom queries inside the command
const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

export default {
  data: new SlashCommandBuilder()
    .setName('voice-ranking')
    .setDescription('Displays a leaderboard of the top users in voice chat overall or in a specific channel.')
    .setContexts(InteractionContextType.Guild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Optional voice channel to filter by.')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period to analyze voice ranking.')
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

    const channel = interaction.options.getChannel('channel');
    const timeframe = interaction.options.getString('timeframe') || '7d';
    const days = timeframeToDays(timeframe);
    const guildId = guild.id;

    let leaderboard = [];

    // Case 1: Filter by specific channel
    if (channel) {
      try {
        let query = supabase
          .from('voice_sessions')
          .select('user_id, join_time, leave_time')
          .eq('guild_id', guildId)
          .eq('channel_id', channel.id);

        if (days > 0) {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          query = query.gte('join_time', cutoff.toISOString());
        }

        const { data, error } = await query;
        if (error) throw error;

        // Group by user and calculate total seconds
        const userDurations = {};
        for (const session of data || []) {
          const join = new Date(session.join_time).getTime();
          const leave = session.leave_time ? new Date(session.leave_time).getTime() : Date.now();
          const durationSeconds = Math.max(0, (leave - join) / 1000);

          userDurations[session.user_id] = (userDurations[session.user_id] || 0) + durationSeconds;
        }

        // Convert to sorted array
        leaderboard = Object.entries(userDurations)
          .map(([userId, score]) => ({ user_id: userId, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 15); // Limit to top 15

      } catch (err) {
        console.error('Error fetching custom voice ranking:', err.message);
        return interaction.editReply({ content: '❌ Failed to fetch voice ranking for that channel.' });
      }
    } else {
      // Case 2: Overall voice leaderboard (Use RPC)
      leaderboard = await db.getActiveMembersLeaderboard(guildId, 'voice', days);
    }

    let memberLabels = await resolveMemberLabels(guild, leaderboard.map(row => row.user_id));
    let visibleLeaderboard = leaderboard.filter(row => memberLabels.has(String(row.user_id)));

    if (!channel && visibleLeaderboard.length !== leaderboard.length) {
      const memberIds = await getGuildMemberIds(guild);
      leaderboard = await db.getActiveMembersLeaderboardForIds(guildId, 'voice', days, memberIds);
      memberLabels = await resolveMemberLabels(guild, leaderboard.map(row => row.user_id));
      visibleLeaderboard = leaderboard.filter(row => memberLabels.has(String(row.user_id)));
    }

    leaderboard = visibleLeaderboard;

    if (leaderboard.length === 0) {
      const channelText = channel ? `in <#${channel.id}> ` : '';
      const emptyEmbed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('🔊 Voice Rank Leaderboard')
        .setDescription(`No voice chat activity recorded ${channelText}during the **${formatTimeframeLabel(timeframe)}**.\n\n*Hop into voice to start ranking!*`)
        .setFooter({ text: 'Is It Active? • Voice Leaderboard', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();
      return interaction.editReply({ embeds: [emptyEmbed] });
    }

    const maxSeconds = parseInt(leaderboard[0].score);
    const rankEmojis = ['🥇', '🥈', '🥉'];

    const leaderboardText = leaderboard.map((row, index) => {
      const rankStr = index < 3 ? rankEmojis[index] : `\`${String(index + 1).padStart(2, ' ')}.\``;
      const durationFormatted = formatDuration(parseInt(row.score));
      const fraction = maxSeconds > 0 ? parseInt(row.score) / maxSeconds : 0;
      const bar = progressBar(fraction, 8);
      const memberLabel = memberLabels.get(String(row.user_id)) || 'Unknown member';

      return `${rankStr} **${memberLabel}** — **${durationFormatted}**\n\`  \` ${bar} \`${Math.round(fraction * 100)}%\``;
    }).join('\n\n');

    const channelTitleLabel = channel ? ` — <#${channel.id}>` : '';
    const voiceEmbed = new EmbedBuilder()
      .setColor('#8B5CF6') // Purple Accent
      .setTitle(`🔊 Voice Ranking Leaderboard${channelTitleLabel}`)
      .setDescription(`Ranks of users who spent the most time in voice chat during the **${formatTimeframeLabel(timeframe)}**.\n\n${leaderboardText}`)
      .setFooter({ text: 'Is It Active? • Voice Standings', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [voiceEmbed] });
  }
};
