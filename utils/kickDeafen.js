export const KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS = 5 * 60;

export const KICK_DEAFEN_INACTIVITY_CHOICES = [
  { name: '1sec', value: '1sec', seconds: 1, label: '1 second' },
  { name: '1min', value: '1min', seconds: 60, label: '1 minute' },
  { name: '2mins', value: '2mins', seconds: 2 * 60, label: '2 minutes' },
  { name: '5mins', value: '5mins', seconds: 5 * 60, label: '5 minutes' },
  { name: '10mins', value: '10mins', seconds: 10 * 60, label: '10 minutes' },
  { name: '30mins', value: '30mins', seconds: 30 * 60, label: '30 minutes' }
];

const KICK_DEAFEN_CHOICE_BY_VALUE = new Map(
  KICK_DEAFEN_INACTIVITY_CHOICES.map(choice => [choice.value, choice])
);

export function resolveKickDeafenInactivity(value) {
  if (!value) {
    return KICK_DEAFEN_INACTIVITY_CHOICES.find(choice => choice.seconds === KICK_DEAFEN_DEFAULT_INACTIVITY_SECONDS);
  }

  return KICK_DEAFEN_CHOICE_BY_VALUE.get(value) || null;
}

export function formatKickDeafenDuration(seconds) {
  const choice = KICK_DEAFEN_INACTIVITY_CHOICES.find(item => item.seconds === Number(seconds));
  if (choice) return choice.label;

  if (seconds === 1) return '1 second';
  if (seconds < 60) return `${seconds} seconds`;

  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function isVoiceStateDeafened(voiceState) {
  return Boolean(voiceState?.selfDeaf || voiceState?.serverDeaf);
}
