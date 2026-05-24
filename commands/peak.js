import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { timeframeToDays, formatTimeframeLabel, formatHour } from '../utils/formatters.js';
import { generateHorizontalBarChart } from '../utils/charts.js';
import { requireGuild } from '../utils/interactions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('peak-hours')
    .setDescription('Displays a visual 24-hour activity bar chart and peak hours for the server.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('timeframe')
        .setDescription('The time period to analyze peak hours.')
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

    const hourlyData = await db.getHourlyPeakAnalysis(guildId, days);

    if (hourlyData.length === 0 || hourlyData.every(h => parseInt(h.message_count) === 0 && parseInt(h.voice_join_count) === 0)) {
      const emptyEmbed = new EmbedBuilder()
        .setColor('#EF4444')
        .setTitle('⏰ Server Peak Hours')
        .setDescription(`No activity data recorded in the **${formatTimeframeLabel(timeframe)}** to analyze peak hours.`)
        .setFooter({ text: 'Is It Active? • Peak Hours', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();
      return interaction.editReply({ embeds: [emptyEmbed] });
    }

    // 1. Prepare data for the chart
    // We will group into 2-hour blocks to keep the embed length super clean and readable!
    // This is an extremely elegant design choice that fits perfectly in a single mobile screen!
    const blockLabels = [];
    const blockValues = [];
    
    for (let i = 0; i < 24; i += 2) {
      const h1 = hourlyData.find(h => parseInt(h.hour_of_day) === i);
      const h2 = hourlyData.find(h => parseInt(h.hour_of_day) === i + 1);
      
      const val1 = h1 ? parseInt(h1.message_count || 0) : 0;
      const val2 = h2 ? parseInt(h2.message_count || 0) : 0;
      
      const labelStr = `${String(i).padStart(2, '0')}-${String(i+1).padStart(2, '0')}`;
      blockLabels.push(labelStr);
      blockValues.push(val1 + val2);
    }

    const chartText = generateHorizontalBarChart(blockLabels, blockValues, 12);

    // 2. Identify top peak hours (single hours)
    const sortedHours = [...hourlyData].sort((a, b) => 
      (parseInt(b.message_count) + parseInt(b.voice_join_count) * 5) - 
      (parseInt(a.message_count) + parseInt(a.voice_join_count) * 5)
    );

    const topHoursText = sortedHours.slice(0, 3).map((h, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      const totalWeight = parseInt(h.message_count) + parseInt(h.voice_join_count);
      return `${medals[idx]} **${formatHour(h.hour_of_day)} UTC** — \`${h.message_count}\` msgs, \`${h.voice_join_count}\` voice joins`;
    }).join('\n');

    // 3. Build UI Embed
    const peakEmbed = new EmbedBuilder()
      .setColor('#F59E0B') // Amber color
      .setTitle(`⏰ Server Peak Hours — ${guild.name}`)
      .setDescription(`Hourly activity heatmap and peak periods during the **${formatTimeframeLabel(timeframe)}**.`)
      .addFields(
        {
          name: '📊 24-Hour Activity Distribution (UTC)',
          value: `\`\`\`\nHour   Activity Level    Volume\n${chartText}\n\`\`\``,
          inline: false
        },
        {
          name: '🔥 Top Peak Activity Hours',
          value: topHoursText || 'Insufficient data to determine peak hours.',
          inline: false
        }
      )
      .setFooter({ text: 'Is It Active? • Peak Hours Analysis', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [peakEmbed] });
  }
};
