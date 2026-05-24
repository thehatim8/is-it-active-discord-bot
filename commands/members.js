import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { formatDuration, timeframeToDays, formatTimeframeLabel } from '../utils/formatters.js';
import { progressBar } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';
import { getGuildMemberIds, resolveMemberLabels } from '../utils/discordLabels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('active-members')
    .setDescription('Displays a leaderboard of the top active members in the server.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Leaderboard metric: messages sent, voice duration, or combined activity.')
        .setRequired(false)
        .addChoices(
          { name: 'Text Messages (Count)', value: 'text' },
          { name: 'Voice Chat (Duration)', value: 'voice' },
          { name: 'Combined Activity Index', value: 'combined' }
        ))
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period for the leaderboard.')
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

    const type = interaction.options.getString('type') || 'combined';
    const timeframe = interaction.options.getString('timeframe') || '7d';
    const days = timeframeToDays(timeframe);
    const guildId = guild.id;

    let leaderboard = await db.getActiveMembersLeaderboard(guildId, type, days);
    let memberLabels = await resolveMemberLabels(guild, leaderboard.map(row => row.user_id));
    let visibleLeaderboard = leaderboard.filter(row => memberLabels.has(String(row.user_id)));

    if (visibleLeaderboard.length !== leaderboard.length) {
      const memberIds = await getGuildMemberIds(guild);
      leaderboard = await db.getActiveMembersLeaderboardForIds(guildId, type, days, memberIds);
      memberLabels = await resolveMemberLabels(guild, leaderboard.map(row => row.user_id));
      visibleLeaderboard = leaderboard.filter(row => memberLabels.has(String(row.user_id)));
    }

    leaderboard = visibleLeaderboard;

    if (leaderboard.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('🥇 Active Members Leaderboard')
        .setDescription(`No activity recorded in **${formatTimeframeLabel(timeframe)}** to rank members.\n\n*Be the first to say something!*`)
        .setFooter({ text: 'Is It Active? • Active Members', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();
      return interaction.editReply({ embeds: [emptyEmbed] });
    }

    // Determine type label and score formatter
    let metricLabel = '';
    let formatScore = (score) => score;

    if (type === 'text') {
      metricLabel = 'Messages';
      formatScore = (score) => `**${score}** msgs`;
    } else if (type === 'voice') {
      metricLabel = 'Voice Time';
      formatScore = (score) => `**${formatDuration(parseInt(score))}**`;
    } else {
      metricLabel = 'Activity Score';
      formatScore = (score) => `**${score}** points`;
    }

    const maxScore = parseInt(leaderboard[0].score);

    // Build the visual leaderboard description
    const rankEmojis = ['🥇', '🥈', '🥉'];
    const fieldsText = leaderboard.map((row, index) => {
      const rankStr = index < 3 ? rankEmojis[index] : `\`${String(index + 1).padStart(2, ' ')}.\``;
      const fraction = maxScore > 0 ? parseInt(row.score) / maxScore : 0;
      const bar = progressBar(fraction, 8);
      const memberLabel = memberLabels.get(String(row.user_id)) || 'Unknown member';
      
      return `${rankStr} **${memberLabel}** — ${formatScore(row.score)}\n\`  \` ${bar} \`${Math.round(fraction * 100)}%\``;
    }).join('\n\n');

    const leaderboardEmbed = new EmbedBuilder()
      .setColor('#5865F2') // Discord Purple blue
      .setTitle(`🥇 Active Members Leaderboard — ${guild.name}`)
      .setDescription(`Ranks of the top active members by **${metricLabel}** during the **${formatTimeframeLabel(timeframe)}**.\n\n${fieldsText}`)
      .setFooter({ text: `Is It Active? • Top Members (${metricLabel})`, iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [leaderboardEmbed] });
  }
};
