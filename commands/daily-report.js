import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { formatDuration, formatHour } from '../utils/formatters.js';
import { requireGuild } from '../utils/interactions.js';
import {
  getChannelLabel,
  getGuildMemberIds,
  getReadableGuildTextChannelIds,
  getReadableGuildVoiceChannelIds,
  refreshGuildChannels,
  resolveMemberLabels
} from '../utils/discordLabels.js';

function getTodayWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full'
  }).format(date);
}

export default {
  data: new SlashCommandBuilder()
    .setName('daily-report')
    .setDescription("Shows today's server activity report.")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = await requireGuild(interaction);
    if (!guild) return;

    const guildId = guild.id;
    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
      return interaction.editReply({ content: 'I could not verify my server permissions. Please try again in a moment.' });
    }

    await refreshGuildChannels(guild);

    const textChannelIds = getReadableGuildTextChannelIds(guild, botMember);
    const voiceChannelIds = getReadableGuildVoiceChannelIds(guild, botMember);
    const memberIds = await getGuildMemberIds(guild);
    const today = getTodayWindow();

    const [summary, topChannels, topMembers] = await Promise.all([
      db.getServerHealthSummaryForIds(guildId, {
        textChannelIds,
        voiceChannelIds,
        startIso: today.startIso,
        endIso: today.endIso
      }),
      db.getActiveChannelsForIds(guildId, textChannelIds, 0, 1, {
        startIso: today.startIso,
        endIso: today.endIso
      }),
      db.getActiveMembersLeaderboardForIds(guildId, 'combined', 0, memberIds, 1, {
        startIso: today.startIso,
        endIso: today.endIso
      })
    ]);

    const memberLabels = await resolveMemberLabels(guild, topMembers.map(row => row.user_id));
    const topChannel = topChannels[0] || null;
    const topMember = topMembers[0] || null;
    const topMemberLabel = topMember ? memberLabels.get(String(topMember.user_id)) || `<@${topMember.user_id}>` : null;
    const totalMessages = Number(summary?.total_messages || 0);
    const totalVoiceSeconds = Number(summary?.total_voice_seconds || 0);
    const activeUsers = Number(summary?.active_users || 0);

    const reportEmbed = new EmbedBuilder()
      .setColor('#38BDF8')
      .setTitle(`Daily Activity Report - ${guild.name}`)
      .setDescription(`Activity for **${formatDateLabel(today.start)}**.`)
      .addFields(
        {
          name: 'Messages Today',
          value: `\`${totalMessages.toLocaleString()}\` messages`,
          inline: true
        },
        {
          name: 'Voice Time Today',
          value: `\`${formatDuration(totalVoiceSeconds)}\``,
          inline: true
        },
        {
          name: 'Active Users Today',
          value: `\`${activeUsers.toLocaleString()}\` users`,
          inline: true
        },
        {
          name: 'Top Channel',
          value: topChannel
            ? `${getChannelLabel(guild, topChannel.channel_id)} with \`${Number(topChannel.message_count).toLocaleString()}\` messages`
            : 'No text channel activity yet today.',
          inline: false
        },
        {
          name: 'Top Member',
          value: topMember
            ? `${topMemberLabel} with \`${Number(topMember.score).toLocaleString()}\` activity points`
            : 'No member activity yet today.',
          inline: false
        },
        {
          name: 'Peak Hour',
          value: totalMessages > 0 || totalVoiceSeconds > 0
            ? `\`${formatHour(summary.server_peak_hour)}\``
            : 'No peak hour yet today.',
          inline: false
        }
      )
      .setFooter({ text: 'Is It Active? - Daily Report', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [reportEmbed] });
  }
};
