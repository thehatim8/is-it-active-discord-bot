import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { setAfk } from '../utils/afk.js';

export default {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status and an optional reason.')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Why you are going AFK.')
        .setMaxLength(1000)
        .setRequired(false)),

  async execute(interaction) {
    const reason = interaction.options.getString('reason');
    const afk = setAfk(interaction.guildId, interaction.user.id, reason);

    await interaction.reply({
      content: `You are now AFK: ${afk.reason}`,
      allowedMentions: { parse: [] }
    });
  }
};

