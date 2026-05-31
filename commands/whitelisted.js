import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { requireGuild } from '../utils/interactions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('whitelisted')
    .setDescription('Set the role exempt from kick-deafen voice disconnects.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Members with this role will not be disconnected for staying deafened.')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = await requireGuild(interaction);
    if (!guild) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Only administrators can configure the kick-deafen whitelist role.' });
    }

    const role = interaction.options.getRole('role', true);
    if (role.id === guild.id) {
      return interaction.editReply({ content: 'Please choose a normal server role, not @everyone.' });
    }

    const ok = await db.setKickDeafenWhitelistedRole(guild.id, role.id);
    if (!ok) {
      return interaction.editReply({ content: 'Failed to save the whitelisted role. Check the bot console and database table.' });
    }

    if (typeof interaction.client.refreshKickDeafenGuild === 'function') {
      await interaction.client.refreshKickDeafenGuild(guild);
    }

    const embed = new EmbedBuilder()
      .setColor('#10B981')
      .setTitle('Kick-Deafen Whitelist')
      .setDescription(`Members with ${role} will not be disconnected for staying deafened in voice.`)
      .setFooter({ text: `Configured for ${guild.name}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};
