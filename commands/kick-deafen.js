import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { requireGuild } from '../utils/interactions.js';
import {
  KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS,
  KICK_DEAFEN_INACTIVITY_CHOICES,
  formatKickDeafenDuration,
  resolveKickDeafenInactivity
} from '../utils/kickDeafen.js';

export default {
  data: new SlashCommandBuilder()
    .setName('kick-deafen')
    .setDescription('Disconnect users from voice after they stay deafened for too long.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(option =>
      option
        .setName('enabled')
        .setDescription('Turn automatic voice disconnects for deafened users on or off. Defaults to false.')
        .setRequired(false))
    .addStringOption(option =>
      option
        .setName('inactivity')
        .setDescription('How long a user can stay deafened before being disconnected. Defaults to 5mins.')
        .setRequired(false)
        .addChoices(...KICK_DEAFEN_INACTIVITY_CHOICES.map(choice => ({
          name: choice.name,
          value: choice.value
        })))),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = await requireGuild(interaction);
    if (!guild) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Only administrators can configure automatic voice disconnects.' });
    }

    const enabled = interaction.options.getBoolean('enabled') ?? false;
    const inactivityValue = interaction.options.getString('inactivity');
    const inactivity = resolveKickDeafenInactivity(inactivityValue);

    if (!inactivity) {
      return interaction.editReply({ content: 'Invalid inactivity value. Please use one of the provided choices.' });
    }

    if (enabled) {
      const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      if (!botMember?.permissions?.has(PermissionFlagsBits.MoveMembers)) {
        return interaction.editReply({
          content: 'I need the **Move Members** permission before I can disconnect deafened users from voice channels.'
        });
      }
    }

    const ok = await db.setKickDeafenSettings(guild.id, {
      enabled,
      inactivitySeconds: inactivity.seconds || KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS
    });

    if (!ok) {
      return interaction.editReply({ content: 'Failed to save the `/kick-deafen` setting. Check the bot console and database table.' });
    }

    if (typeof interaction.client.refreshKickDeafenGuild === 'function') {
      await interaction.client.refreshKickDeafenGuild(guild);
    }

    const embed = new EmbedBuilder()
      .setColor(enabled ? '#F59E0B' : '#64748B')
      .setTitle('Kick Deafen Settings')
      .setDescription(enabled
        ? `Deafened users will be disconnected after **${formatKickDeafenDuration(inactivity.seconds)}** in voice.`
        : 'Automatic voice disconnects for deafened users are now disabled.')
      .addFields(
        {
          name: 'Enabled',
          value: enabled ? 'True' : 'False',
          inline: true
        },
        {
          name: 'Inactivity',
          value: formatKickDeafenDuration(inactivity.seconds),
          inline: true
        }
      )
      .setFooter({ text: `Configured for ${guild.name}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
