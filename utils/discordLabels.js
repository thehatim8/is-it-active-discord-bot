import { ChannelType, PermissionFlagsBits } from 'discord.js';

export async function refreshGuildChannels(guild) {
  await guild.channels.fetch().catch(err => {
    console.error(`Failed to refresh channels for guild ${guild.name}:`, err.message);
  });
}

export function getGuildTextChannelIds(guild) {
  return Array.from(guild.channels.cache.values())
    .filter(channel =>
      channel &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    )
    .map(channel => channel.id);
}

export function getReadableGuildTextChannelIds(guild, member) {
  return Array.from(guild.channels.cache.values())
    .filter(channel =>
      channel &&
      (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
      channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    )
    .map(channel => channel.id);
}

export function getGuildVoiceChannelIds(guild) {
  return Array.from(guild.channels.cache.values())
    .filter(channel =>
      channel &&
      (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
    )
    .map(channel => channel.id);
}

export function getReadableGuildVoiceChannelIds(guild, member) {
  return Array.from(guild.channels.cache.values())
    .filter(channel =>
      channel &&
      (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) &&
      channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
    )
    .map(channel => channel.id);
}

export function getChannelLabel(guild, channelId) {
  const channel = guild.channels.cache.get(String(channelId));
  return channel ? `<#${channel.id}>` : null;
}

export async function getGuildMemberIds(guild) {
  await guild.members.fetch().catch(err => {
    console.error(`Failed to refresh members for guild ${guild.name}:`, err.message);
  });

  return Array.from(guild.members.cache.values())
    .filter(member => member && !member.user.bot)
    .map(member => member.id);
}

export async function resolveMemberLabels(guild, userIds) {
  const uniqueIds = [...new Set(userIds.map(String).filter(Boolean))];
  const labels = new Map();
  const missingIds = [];

  for (const userId of uniqueIds) {
    const cached = guild.members.cache.get(userId);
    if (cached) {
      labels.set(userId, formatMemberLabel(cached));
    } else {
      missingIds.push(userId);
    }
  }

  if (missingIds.length > 0) {
    await guild.members.fetch({ user: missingIds }).catch(() => null);

    for (const userId of missingIds) {
      const member = guild.members.cache.get(userId);
      if (member) {
        labels.set(userId, formatMemberLabel(member));
        continue;
      }

      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user) {
        labels.set(userId, `<@${user.id}>`);
      }
    }
  }

  return labels;
}

function formatMemberLabel(member) {
  return `<@${member.id}>`;
}
