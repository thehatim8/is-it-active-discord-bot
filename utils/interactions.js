const GUILD_ONLY_MESSAGE = 'This command can only be used inside a Discord server.';

async function replySafely(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(async () => {
      await interaction.followUp({ content: payload.content, ephemeral: true }).catch(() => {});
    });
    return;
  }

  await interaction.reply({ content: payload.content, ephemeral: true }).catch(() => {});
}

export async function requireGuild(interaction) {
  if (!interaction.inGuild() || !interaction.guildId) {
    await replySafely(interaction, {
      content: GUILD_ONLY_MESSAGE,
      embeds: [],
      components: []
    });
    return null;
  }

  if (interaction.guild) {
    return interaction.guild;
  }

  const guild = await interaction.client.guilds.fetch(interaction.guildId).catch(() => null);
  if (guild) {
    return guild;
  }

  await replySafely(interaction, {
    content: 'I could not load this server. Please try again in a moment.',
    embeds: [],
    components: []
  });
  return null;
}
