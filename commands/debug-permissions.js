import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, InteractionContextType } from 'discord.js';
import { requireGuild } from '../utils/interactions.js';
import { getChannelLabel, refreshGuildChannels } from '../utils/discordLabels.js';

const FIELD_LIMIT = 950;

function getTextLikeChannels(guild) {
  return Array.from(guild.channels.cache.values())
    .filter(channel =>
      channel &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    )
    .sort((a, b) => a.rawPosition - b.rawPosition);
}

function getPermissionStatus(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);

  if (!permissions) {
    return {
      canRead: false,
      missing: ['Permission data unavailable']
    };
  }

  const missing = [];
  if (!permissions.has(PermissionFlagsBits.ViewChannel)) {
    missing.push('View Channel');
  }
  if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
    missing.push('Read Message History');
  }

  return {
    canRead: missing.length === 0,
    missing
  };
}

function formatChannelRows(rows, emptyText) {
  if (rows.length === 0) return emptyText;

  const lines = [];
  let hidden = 0;

  for (const row of rows) {
    const nextLine = row.reason
      ? `${row.label} - missing: ${row.reason}`
      : row.label;
    const nextValue = [...lines, nextLine].join('\n');

    if (nextValue.length > FIELD_LIMIT) {
      hidden++;
      continue;
    }

    lines.push(nextLine);
  }

  if (hidden > 0) {
    lines.push(`...and ${hidden} more`);
  }

  return lines.join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('debug-permissions')
    .setDescription('Shows which text channels the bot can or cannot read.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = await requireGuild(interaction);
    if (!guild) return;

    const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
    if (!botMember) {
      return interaction.editReply({ content: 'I could not verify my server permissions. Please try again in a moment.' });
    }

    await refreshGuildChannels(guild);

    const channels = getTextLikeChannels(guild);
    const readable = [];
    const blocked = [];

    for (const channel of channels) {
      const status = getPermissionStatus(channel, botMember);
      const row = {
        label: getChannelLabel(guild, channel.id) || `#${channel.name}`,
        reason: status.missing.join(', ')
      };

      if (status.canRead) {
        readable.push(row);
      } else {
        blocked.push(row);
      }
    }

    const debugEmbed = new EmbedBuilder()
      .setColor(blocked.length === 0 ? '#10B981' : '#F59E0B')
      .setTitle(`Permission Debug - ${guild.name}`)
      .setDescription('This checks text and announcement channels for the permissions required by `/backfill` and text analytics.')
      .addFields(
        {
          name: 'Summary',
          value: `**Readable:** \`${readable.length}\`\n**Blocked:** \`${blocked.length}\`\n**Total Text Channels:** \`${channels.length}\``,
          inline: false
        },
        {
          name: 'Can Read',
          value: formatChannelRows(readable, 'No readable text channels found.'),
          inline: false
        },
        {
          name: 'Cannot Read',
          value: formatChannelRows(blocked, 'No blocked text channels found.'),
          inline: false
        }
      )
      .setFooter({ text: 'Is It Active? - Permission Debug', iconURL: interaction.client.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.editReply({ embeds: [debugEmbed] });
  }
};
