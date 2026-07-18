const afkUsers = new Map();

const DEFAULT_REASON = 'No reason provided.';
const MAX_REASON_LENGTH = 1000;

function getAfkKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function cleanReason(reason) {
  const trimmedReason = reason?.trim();
  return (trimmedReason || DEFAULT_REASON).slice(0, MAX_REASON_LENGTH);
}

function formatElapsedTime(startedAt) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));

  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h`;
  return `${Math.floor(elapsedSeconds / 86400)}d`;
}

export function setAfk(guildId, userId, reason) {
  const afk = {
    reason: cleanReason(reason),
    startedAt: Date.now()
  };

  afkUsers.set(getAfkKey(guildId, userId), afk);
  return afk;
}

export function getAfk(guildId, userId) {
  return afkUsers.get(getAfkKey(guildId, userId)) || null;
}

export function clearAfk(guildId, userId) {
  const key = getAfkKey(guildId, userId);
  const afk = afkUsers.get(key) || null;
  afkUsers.delete(key);
  return afk;
}

export async function handleAfkMessage(message) {
  const afkCommand = message.content.match(/^!afk(?:\s+([\s\S]*))?$/i);

  if (afkCommand) {
    const afk = setAfk(message.guildId, message.author.id, afkCommand[1]);
    await message.reply({
      content: `💤 You are now AFK: ${afk.reason}`,
      allowedMentions: { parse: [], repliedUser: false }
    });
    return;
  }

  const previousAfk = clearAfk(message.guildId, message.author.id);
  if (previousAfk) {
    await message.reply({
      content: `👋 Welcome back! I removed your AFK status after ${formatElapsedTime(previousAfk.startedAt)}.`,
      allowedMentions: { parse: [], repliedUser: false }
    });
  }

  const mentionedAfkMembers = [];
  for (const user of message.mentions.users.values()) {
    if (user.id === message.author.id || user.bot) continue;

    const afk = getAfk(message.guildId, user.id);
    if (afk) {
      mentionedAfkMembers.push(
        `💤 ${user.username} is AFK: ${afk.reason} (${formatElapsedTime(afk.startedAt)} ago)`
      );
    }
  }

  if (mentionedAfkMembers.length > 0) {
    await message.reply({
      content: mentionedAfkMembers.join('\n').slice(0, 2000),
      allowedMentions: { parse: [], repliedUser: false }
    });
  }
}
