// A Group's SOS / Ping switches and mutes, and where they are kept.
//
// The settings live on the squad object itself (squad.settings), not on whoever holds
// command: a stand-in taking over while the Commander is away, and the Commander
// reclaiming the squad, move command around without touching them. They are changed only
// by the Group's own Commander (see canChangeSettings), and saved to a SettingsStore so
// that they outlast the squad object itself: the 5-minute sweep deletes an idle squad, and
// a restart deletes all of them.

import fs from 'node:fs';

export const defaultSettings = () => ({
  sosEnabled: true,
  pingEnabled: true,
  // memberKey()s (uid, or socket id for a person without one) whose pings the Group Lead
  // has muted. Their SOS is never muted.
  mutedPingers: [],
});

// Reading never creates anything: a squad nobody has configured has no settings of its own,
// which is how the server knows there is nothing worth saving.
export const settingsOf = (squad) => squad.settings ?? defaultSettings();
const ensureSettings = (squad) => (squad.settings ??= defaultSettings());

/** Who may change a Group's settings: its own Commander, connected and holding command.
 *  A stand-in holds command for a while but is not the Commander, so settings stay as the
 *  Commander left them. A squad with no uids at all (an old client) falls back to command. */
export function canChangeSettings(squad, socketId, socketUid, commanderUid) {
  if (!squad || squad.ownerId !== socketId) return false;
  return !commanderUid || socketUid === commanderUid;
}

/** Applies { sosEnabled?, pingEnabled? } to the squad's settings. Only real booleans are
 *  taken; anything else is ignored. Returns whether anything changed. */
export function updateSwitches(squad, update) {
  const settings = ensureSettings(squad);
  let changed = false;
  for (const key of ['sosEnabled', 'pingEnabled']) {
    if (typeof update?.[key] === 'boolean' && settings[key] !== update[key]) {
      settings[key] = update[key];
      changed = true;
    }
  }
  return changed;
}

export const isPingerMuted = (squad, key) => settingsOf(squad).mutedPingers.includes(key);

/** Mutes or unmutes `key`'s pings Group-wide. Returns whether anything changed. */
export function setPingerMuted(squad, key, muted) {
  if (!key) return false;
  const settings = ensureSettings(squad);
  const has = settings.mutedPingers.includes(key);
  if (muted && !has) settings.mutedPingers.push(key);
  else if (!muted && has) settings.mutedPingers = settings.mutedPingers.filter((k) => k !== key);
  else return false;
  return true;
}

// A person's own mutes: whose pings THEY don't want. Per recipient, in memory. No
// prototype, because both sides are client-supplied identities.
export function setPersonallyMuted(squad, recipientKey, senderKey, muted) {
  if (!recipientKey || !senderKey) return false;
  squad.personalMutes = squad.personalMutes || Object.create(null);
  const list = squad.personalMutes[recipientKey] || [];
  const has = list.includes(senderKey);
  if (muted && !has) squad.personalMutes[recipientKey] = [...list, senderKey];
  else if (!muted && has) squad.personalMutes[recipientKey] = list.filter((k) => k !== senderKey);
  else return false;
  return true;
}

export const isPersonallyMuted = (squad, recipientKey, senderKey) =>
  Boolean(squad.personalMutes?.[recipientKey]?.includes(senderKey));

/** What one member is told about their Group's settings. The Group Lead also gets who is
 *  muted (as the socket ids the map and member list use); everyone gets only whether
 *  they themselves are. */
export function settingsFor(squad, roomCode, { key, isLead, keyOf }) {
  const settings = settingsOf(squad);
  const view = {
    roomCode,
    sosEnabled: settings.sosEnabled,
    pingEnabled: settings.pingEnabled,
    pingMuted: settings.mutedPingers.includes(key),
  };
  if (isLead) view.mutedMemberIds = squad.members.filter((id) => settings.mutedPingers.includes(keyOf(id)));
  return view;
}

// --- Keeping settings past the squad ------------------------------------------------------------

/**
 * Saved settings by room code: { commanderUid, settings, savedAt }. Held in memory, and
 * mirrored to a JSON file when a path is given (LOCUS_SETTINGS_FILE), which is what lets
 * them outlast a restart wherever that file is on storage that survives one. Render's
 * default disk does not; a Render persistent disk, or the Firestore store Stage 4 adds,
 * does. Without a path they outlast the squad but not the process.
 *
 * A record is restored only to the person who set it up, by uid, and only for ttlMs.
 */
export function createSettingsStore({ filePath = null, ttlMs, now = Date.now } = {}) {
  const records = Object.create(null);

  if (filePath) {
    try {
      Object.assign(records, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[SETTINGS] Could not read ${filePath}: ${err.message}`);
    }
  }

  const flush = () => {
    if (!filePath) return;
    try {
      fs.writeFileSync(filePath, JSON.stringify(records));
    } catch (err) {
      console.warn(`[SETTINGS] Could not save ${filePath}: ${err.message}`);
    }
  };

  return {
    /** The saved settings for `roomCode` if `commanderUid` is the person who saved them
     *  and they are not too old; otherwise null. */
    restore(roomCode, commanderUid) {
      const record = records[roomCode];
      if (!record || !commanderUid || record.commanderUid !== commanderUid) return null;
      if (now() - record.savedAt > ttlMs) return null;
      return { ...defaultSettings(), ...record.settings, mutedPingers: [...(record.settings?.mutedPingers ?? [])] };
    },
    save(roomCode, commanderUid, settings) {
      records[roomCode] = {
        commanderUid: commanderUid ?? null,
        settings: { ...settings, mutedPingers: [...settings.mutedPingers] },
        savedAt: now(),
      };
      flush();
    },
    has: (roomCode) => Boolean(records[roomCode]),
  };
}
