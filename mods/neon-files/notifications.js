// Canonical helper; installed as a local copy because mods isolate imports.
// Called only by event handlers, never render(). The host owns agent alerts.
import {notify as nativeNotify, playSound, settings, shared, setShared} from "herdr";

export const PREFERENCES = "neon.notifications.preferences";
const RECENT = "neon.notifications.recent";
const LAST_SOUND = "neon.notifications.last-sound";
export function preferences() { return shared(PREFERENCES) ?? {}; }

export function soundFor(level) {
  return level === "success" ? "done" : level === "warning" ? "blocked"
    : level === "error" ? "sounds/neon/error.mp3" : "sounds/neon/info.mp3";
}

export function emitSound(level, {preview = false} = {}) {
  const prefs = preferences(), now = Date.now();
  if (settings()?.sounds?.enabled === false) return false;
  if (!preview && (prefs.sound === false || (level === "info" && prefs.info !== true))) return false;
  const previous = Number(shared(LAST_SOUND)) || 0;
  if (now - previous < 1200 && now >= previous) return false;
  // One bounded shared write per audible event, no polling or animation loop.
  setShared(LAST_SOUND, now);
  playSound(soundFor(level));
  return true;
}

export function notify(message, options = {}) {
  const prefs = preferences(), now = Date.now();
  const level = ["info", "success", "warning", "error"].includes(message.level) ? message.level : "info";
  const toast = options.toast !== false && prefs.toast !== false;
  const audible = options.sound !== false && prefs.sound !== false;
  if (!toast && !audible) return null;
  // Store only compact fingerprints, never message bodies, file paths or keys.
  const key = fingerprint(options.key ?? JSON.stringify([options.category, message.title, message.body]));
  const ledger = shared(RECENT);
  const recent = Array.isArray(ledger) ? ledger.filter(r => Array.isArray(r) && r[1] > now && r[1] <= now + 86400000) : [];
  if (recent.some(r => r[0] === key)) return null;
  const ttl = Math.max(1000, Math.min(86400000, Number(options.dedupeMs) || 6000));
  setShared(RECENT, [...recent.slice(-63), [key, now + ttl]]);
  const id = toast ? nativeNotify({...message, level, timeout: message.timeout ?? (level === "error" || level === "warning" ? 10000 : 5000)}) : null;
  if (audible) emitSound(level);
  return id;
}

function fingerprint(text) {
  let hash = 2166136261;
  for (const ch of String(text)) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
