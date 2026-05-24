import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { db } from '../database.js';
import { requireGuild } from '../utils/interactions.js';

function formatRules(rules) {
  if (rules.length === 0) {
    return 'No roles or members are configured. Only administrators can use bot commands.';
  }

  const roles = rules
    .filter(rule => rule.target_type === 'role')
    .map(rule => `<@&${rule.target_id}>`);
  const members = rules
    .filter(rule => rule.target_type === 'member')
    .map(rule => `<@${rule.target_id}>`);

  return [
    `**Allowed Roles:** ${roles.length > 0 ? roles.join(', ') : 'None'}`,
    `**Allowed Members:** ${members.length > 0 ? members.join(', ') : 'None'}`
  ].join('\n');
}

function makeResultEmbed(guild, title, description, rules) {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(title)
    .setDescription(description)
    .addFields({
      name: 'Current Access',
      value: formatRules(rules),
      inline: false
    })
    .setFooter({ text: `Admins always retain access - ${guild.name}` })
    .setTimestamp();
}

export default {
  data: new SlashCommandBuilder()
    .setName('bot-access')
    .setDescription('Configure which roles and members can use bot commands.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-role')
        .setDescription('Allow a role to use all bot commands.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to allow.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-role')
        .setDescription('Remove a role from bot command access.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to remove.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('add-member')
        .setDescription('Allow a member to use all bot commands.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('Member to allow.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove-member')
        .setDescription('Remove a member from bot command access.')
        .addUserOption(option =>
          option
            .setName('member')
            .setDescription('Member to remove.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List roles and members allowed to use bot commands.'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear all role/member access rules. Admins will remain allowed.')),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = await requireGuild(interaction);
    if (!guild) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Only administrators can configure bot command access.' });
    }

    const subcommand = interaction.options.getSubcommand();
    let title = 'Bot Command Access';
    let description = 'Current command access configuration.';

    if (subcommand === 'add-role') {
      const role = interaction.options.getRole('role', true);
      const ok = await db.addCommandAccessRule(guild.id, 'role', role.id);
      title = ok ? 'Role Allowed' : 'Could Not Add Role';
      description = ok
        ? `${role} can now use bot commands.`
        : `Failed to allow ${role}. Check the bot console and database table.`;
    } else if (subcommand === 'remove-role') {
      const role = interaction.options.getRole('role', true);
      const ok = await db.removeCommandAccessRule(guild.id, 'role', role.id);
      title = ok ? 'Role Removed' : 'Could Not Remove Role';
      description = ok
        ? `${role} can no longer use bot commands unless they are an admin or match another allow rule.`
        : `Failed to remove ${role}. Check the bot console and database table.`;
    } else if (subcommand === 'add-member') {
      const user = interaction.options.getUser('member', true);
      const ok = await db.addCommandAccessRule(guild.id, 'member', user.id);
      title = ok ? 'Member Allowed' : 'Could Not Add Member';
      description = ok
        ? `${user} can now use bot commands.`
        : `Failed to allow ${user}. Check the bot console and database table.`;
    } else if (subcommand === 'remove-member') {
      const user = interaction.options.getUser('member', true);
      const ok = await db.removeCommandAccessRule(guild.id, 'member', user.id);
      title = ok ? 'Member Removed' : 'Could Not Remove Member';
      description = ok
        ? `${user} can no longer use bot commands unless they are an admin or match another allow rule.`
        : `Failed to remove ${user}. Check the bot console and database table.`;
    } else if (subcommand === 'clear') {
      const ok = await db.clearCommandAccessRules(guild.id);
      title = ok ? 'Access Rules Cleared' : 'Could Not Clear Access Rules';
      description = ok
        ? 'All configured roles and members were removed. Only administrators can use bot commands now.'
        : 'Failed to clear access rules. Check the bot console and database table.';
    }

    const rules = await db.getCommandAccessRules(guild.id);
    const embed = makeResultEmbed(guild, title, description, rules);

    await interaction.editReply({ embeds: [embed] });
  }
};
