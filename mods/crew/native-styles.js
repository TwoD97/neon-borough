// Neon notifications and input prompts, re-applied automatically. Herdr hardcodes its own
// `toast` and `prompt` renderers and restores them when it starts, with no setting to point it
// at ours. So after each start (and once a minute, in case it restores them again) the styled
// renderers from neon-toast / neon-prompt are copied into those slots: dependencies first, the
// entry point last, so the hot reload never sees a missing module. Same job as
// tools/install-notifications.ps1, without having to remember to run it.
import { appHome, readTextFile, writeTextFile } from "herdr";

const SLOTS = [
  { slot: "toast", from: "neon-toast", files: ["theme-tokens.js", "fittings.js", "controls.js", "card.js"] },
  { slot: "prompt", from: "neon-prompt", files: ["theme-tokens.js", "fittings.js", "controls.js"] },
];
const CHECK_MS = 60 * 1000;
const same = (a, b) => a != null && b != null && a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();

async function copy(src, dst) {
  const text = await readTextFile(src);
  if (text == null) return false;
  const current = await readTextFile(dst);
  if (!same(text, current)) await writeTextFile(dst, text, current);
  return true;
}

async function applyAll() {
  const mods = `${appHome()}/mods`;
  for (const { slot, from, files } of SLOTS) {
    try {
      const ours = await readTextFile(`${mods}/${from}/main.js`);
      const theirs = await readTextFile(`${mods}/${slot}/main.js`);
      if (ours == null || theirs == null || same(ours, theirs)) continue;
      let ok = true;
      for (const f of files) ok = (await copy(`${mods}/${from}/${f}`, `${mods}/${slot}/${f}`)) && ok;
      if (ok) await writeTextFile(`${mods}/${slot}/main.js`, ours, theirs);
    } catch { /* herdr may be rewriting the slot right now; the next check retries */ }
  }
}

let started = false;
export function startNativeStyles(cx) {
  if (started) return;
  started = true;
  cx.spawn(async () => { await applyAll(); });
  cx.timer.every(CHECK_MS, (cx) => cx.spawn(async () => { await applyAll(); }));
}
