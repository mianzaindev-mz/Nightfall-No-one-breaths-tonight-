// ═══════════════════════════════════════════════════════════════
// NIGHTFALL — Role Definitions
// ═══════════════════════════════════════════════════════════════

export const ROLES = {
  killer: {
    name: 'Killer',
    icon: '🗡',
    color: 'var(--blood-bright)',
    desc: 'Each night, choose a target to eliminate. Blend in during the day. Survive the vote.',
    actionType: 'kill',
    team: 'killer',
    optional: false,
  },
  detective: {
    name: 'Detective',
    icon: '🔍',
    color: 'var(--det-bright)',
    desc: 'Each night, investigate one suspect in limited time. Find the killer before they win.',
    actionType: 'investigate',
    team: 'civilian',
    optional: false,
  },
  civilian: {
    name: 'Civilian',
    icon: '🧑',
    color: '#81c784',
    desc: "No special powers. Observe, discuss, and vote wisely — the town's fate is in your hands.",
    actionType: null,
    team: 'civilian',
    optional: false,
  },
  doctor: {
    name: 'Doctor',
    icon: '🩺',
    color: '#81c784',
    desc: 'Each night, protect one player from being killed. Cannot self-protect two nights in a row.',
    actionType: 'protect',
    team: 'civilian',
    optional: true,
  },
  jester: {
    name: 'Jester',
    icon: '🤡',
    color: '#ff9800',
    desc: 'An agent of chaos. You win if the town votes to execute you. The game continues for others.',
    actionType: null,
    team: 'jester',
    optional: true,
  }
};

export const AVATARS = [
  '🧙','👤','🕵','🧛','👻','🎭','🦹','🧟',
  '🕷','👁','⚔','🔮','🪬','💀','🕯','🩸',
  '🐺','🦇','🌙','🗝','🪶','🐍','🦉','⚗',
  '🎪','🧿','🪦','🐈‍⬛','🌹','🏚','🔔','🃏',
];

/**
 * Assign roles to players.
 * @param {Array} players - array of player objects
 * @param {Object} settings - { doctor: bool, jester: bool }
 * @returns {Array} roles - array of { id, role } mappings
 */
export function assignRoles(players, settings = {}) {
  const n = players.length;
  const killerCount = Math.max(1, Math.floor(n / 4));
  const detCount = Math.max(1, Math.floor(n / 5));
  
  let roles = [];

  // Core roles
  for (let i = 0; i < killerCount; i++) roles.push('killer');
  for (let i = 0; i < detCount; i++) roles.push('detective');

  // Optional roles (one of each max)
  if (settings.doctor && roles.length < n) roles.push('doctor');
  if (settings.jester && roles.length < n) roles.push('jester');

  // Fill remaining with civilians
  while (roles.length < n) roles.push('civilian');

  // Shuffle (Fisher-Yates)
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return players.map((p, i) => ({ id: p.id, role: roles[i] }));
}

/**
 * Get role info for a given role key.
 */
export function getRoleInfo(roleKey) {
  return ROLES[roleKey] || ROLES.civilian;
}
