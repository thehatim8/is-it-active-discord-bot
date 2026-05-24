import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { formatDuration, timeframeToDays, formatTimeframeLabel, formatHour } from '../utils/formatters.js';
import { progressBar } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';
import { getChannelLabel, getGuildVoiceChannelIds, refreshGuildChannels } from '../utils/discordLabels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('active-voice')
    .setDescription('Ranks voice channels by total user voice duration.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period to analyze voice channel activity.')
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

    await refreshGuildChannels(guild);
    const channelIds = getGuildVoiceChannelIds(guild);
    const voiceChannels = await db.getActiveVoiceChannelsForIds(guildId, channelIds, days);

    if (voiceChannels.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('🔊 Active Voice Channels')
        .setDescription(`No voice channel activity recorded in **${formatTimeframeLabel(timeframe)}**.\n\n*Join a voice channel to start logging!*`)
        .setFooter({ text: 'Is It Active? • Voice Channels', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();
      return interaction.editReply({ embeds: [emptyEmbed] });
    }

    const maxSeconds = parseInt(voiceChannels[0].total_seconds);

    const leaderboardText = voiceChannels.map((row, index) => {
      const rankEmoji = index === 0 ? '🏆' : `\`#${index + 1}\``;
      const durationFormatted = formatDuration(parseInt(row.total_seconds));
      const fraction = maxSeconds > 0 ? parseInt(row.total_seconds) / maxSeconds : 0;
      const bar = progressBar(fraction, 8);
      const peakHourFormatted = formatHour(row.peak_hour);
      const channelLabel = getChannelLabel(guild, row.channel_id) || 'Unknown voice channel';

      return `${rankEmoji} **${channelLabel}** — **${durationFormatted}** time spent\n\`  \` ${bar} \`${Math.round(fraction * 100)}%\` • Peak Hour: \`${peakHourFormatted}\``;
    }).join('\n\n');

    const voiceEmbed = new EmbedBuilder()
      .setColor('#60A5FA') // Light Blue
      .setTitle(`🔊 Active Voice Channels — ${guild.name}`)
      .setDescription(`Ranks of voice channels by total user duration during the **${formatTimeframeLabel(timeframe)}**.\n\n${leaderboardText}`)
      .setFooter({ text: 'Is It Active? • Voice Rankings', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [voiceEmbed] });
  }
};
