import {notify, emitSound} from "./notifications.js";
import { fitting } from "./fittings.js";
import { skin, art, artText, mix } from "./theme-tokens.js";
// Waiting for you: merge asks (herdr-pr ask) and secret requests (herdr-pr secret) from every
// machine, in a floating box at the bottom of the work area. It renders nothing when nothing waits,
// so the floating block disappears. The PR panel and the Files panel show the same requests;
// answering in either place clears both.
import { View, div, image, svg } from "gpui-kit";
import { bevel } from "./controls.js";
import { requestFrame } from "./request-skin.js";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, machines, shared, setShared, theme, placement, window as appWindow, home} from "herdr";

const POLL_MS = 10_000;       // while something waits, or soon after a change
const QUIET_POLL_MS = 30_000; // after 2 minutes with nothing waiting
// The one poller for requests on every machine. It shares what it finds as
//   shared("herdr.requests") = { asks: [...], secrets: [...], updated }
// so the PR panel and the Files panel read it instead of asking each machine themselves.
export const REQUESTS_KEY = "herdr.requests";
const RISK = { critical: 0, high: 1, medium: 2, low: 3 };
const NEON = { rail: "#263546", head: "#111c2b", cyan: "#49dcd7", violet: "#b46bdf" };
const name = (m) => m ?? "This computer";
const keyOf = (r) => `${r.kind}:${r.machine ?? ""}:${r.id}`;

function herdrPr(args, machine) {
  if (!machine && appWindow()?.platform === "windows") return exec("python", [`${home().replace(/\\/g, "/")}/.local/bin/herdr-pr`, ...args]);
  return exec("sh", ["-c", 'exec "$HOME/.local/bin/herdr-pr" "$@"', "herdr-pr", ...args], { on: machine ?? undefined });
}

// Pending asks, secret requests and queued requests on one machine, in one call when it can.
async function inboxOf(machine) {
  const r = await herdrPr(["inbox"], machine).catch(() => null);
  if (r?.code === 0) {
    try { return JSON.parse(r.stdout); } catch { /* fall through */ }
  }
  const [asks, secrets] = await Promise.all([list(["asks", "--json"], machine), list(["secrets", "--json"], machine)]);
  return { asks, secrets, outbox: [], old: true };
}

async function list(args, machine) {
  const r = await herdrPr(args, machine).catch(() => null);
  if (!r || r.code !== 0) return [];
  try { return JSON.parse(r.stdout); } catch { return []; }
}

function openExternal(url) {
  const platform = appWindow()?.platform;
  const [cmd, args] = platform === "macos" ? ["open", [url]] : platform === "windows" ? ["explorer.exe", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => {});
}

const UTF8 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += UTF8[(n >> 18) & 63] + UTF8[(n >> 12) & 63] + (i + 1 < bytes.length ? UTF8[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? UTF8[n & 63] : "=");
  }
  return out;
}

export default class Inbox extends View {
  init(_props, cx) {
    this.items = []; this.sig = ""; this.seen = null;
    this.collapsed = false; this.open = new Set(); // cards showing their testing steps
    this.armed = null; this.busy = null; this.errors = new Map();
    // Input states can't be made while drawing: three hidden inputs, lent to secret cards.
    this.slots = new Map();
    this.pool = [0, 1, 2].map(i => {
      const input = InputState.new({ placeholder: "Paste the value" });
      input.set_masked(true);
      input.on("submit", (_e, cx) => { const r = this.itemForSlot(i); if (r) this.fill(r, cx); });
      return input;
    });
    this.load(cx);
    cx.timer.every(POLL_MS, cx => this.load(cx));
  }

  load(cx) {
    if (this.loading) return;
    // Nothing waiting for 2 minutes: poll every 30 s instead of every 10 s.
    if (!this.items.length && Date.now() - (this.changedAt ?? 0) > 120_000 && Date.now() - (this.loadedAt ?? 0) < QUIET_POLL_MS) return;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const where = [null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)];
        const found = await Promise.all(where.map(m => inboxOf(m).then(r => ({ m, r })).catch(() => ({ m, r: null }))));
        const items = [];
        for (const { m, r } of found) {
          if (!r) continue;
          for (const a of r.asks ?? []) if (a?.id && a.state === "pending") items.push({ ...a, kind: "pr", machine: m });
          for (const sc of r.secrets ?? []) if (sc?.id && sc.state === "pending") items.push({ ...sc, kind: "secret", machine: m });
        }
        await this.forward(found);
        items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "secret" ? -1 : 1) || (RISK[a.risk] ?? 2) - (RISK[b.risk] ?? 2) || a.created - b.created);
        this.announce(items);
        const live = new Set(items.map(keyOf));
        for (const k of [...this.slots.keys()]) if (!live.has(k)) this.free(k);
        const sig = JSON.stringify(items);
        if (sig !== this.sig) {
          this.sig = sig; this.items = items; this.changedAt = Date.now();
          // Only on change: setShared re-renders every mod.
          setShared(REQUESTS_KEY, { asks: items.filter(i => i.kind === "pr"), secrets: items.filter(i => i.kind === "secret"), updated: Date.now() });
          cx.notify();
        }
        this.loadedAt = Date.now();
      } finally { this.loading = false; }
    });
  }

  // One toast and the attention sound for new requests (the other panels stay quiet).
  announce(items) {
    const before = this.seen;
    this.seen = new Set(items.map(keyOf));
    if (!before) return;
    const fresh = items.filter(r => !before.has(keyOf(r)));
    if (!fresh.length) return;
    this.collapsed = false;
    const asks = fresh.filter(r => r.kind === "pr"), secrets = fresh.filter(r => r.kind === "secret");
    if (asks.length && shared("pr-hub.request-notifications") !== false) notify({ title: asks.length > 1 ? `${asks.length} merge requests` : "An agent asks you to merge", body: asks.map(a => `${a.repo}#${a.number}${a.title ? ` · ${a.title}` : ""}`).join(" · "), level: "warning", timeout: 10000 }, {sound:false});
    if (secrets.length) notify({ title: "An agent needs a secret", body: secrets.map(r => `${r.key} → ${r.file.split(/[\\/]/).pop()} (${name(r.machine)})`).join(" · "), level: "warning", timeout: 10000 }, {sound:false});
    const askSound = shared("pr-hub.request-sound") !== false;
    if (fresh.some(r => r.kind === "secret" || (askSound && r.kind === "pr"))) emitSound("warning");
  }

  // Requests agents queued on machines that aren't schedulers go to the default scheduler
  // (picked in the PR panel's settings, shared("pr-hub.schedulers")).
  async forward(found) {
    const cfg = shared("pr-hub.schedulers");
    const target = cfg && Array.isArray(cfg.machines) && cfg.machines.includes(cfg.default) ? cfg.default : null;
    if (target === null) return;
    for (const { m, r } of found) {
      const key = m ?? "";
      if (!r?.outbox?.length || cfg.machines.includes(key)) continue;
      for (const q of r.outbox) {
        if (!q?.id) continue;
        const args = q.op === "cancel" ? ["cancel", String(q.ref)]
          : ["schedule", String(q.url), "--at", `@${q.at}`, "--method", String(q.method), "--by", `${q.by} via ${name(m)}`, ...(q.any_head ? ["--any-head"] : []), ...(q.note ? ["--note", String(q.note)] : [])];
        const res = await herdrPr(args, target || null).catch(e => ({ code: 1, stderr: String(e) }));
        if (res.code !== 0) notify({ title: "A PR schedule from an agent failed", body: `${name(m)}: ${String(res.stderr).trim().replace(/^herdr-pr: /, "")}`, level: "error", timeout: 12000 });
        else notify({ title: q.op === "cancel" ? "Scheduled merge cancelled" : "Merge scheduled by an agent", body: `${q.url ?? q.ref} · ${name(m)} → ${name(target || null)}`, level: "info", timeout: 8000 });
        await herdrPr(["outbox-done", String(q.id)], m).catch(() => {});
      }
    }
  }

  slotFor(r) {
    const k = keyOf(r);
    if (!this.slots.has(k)) {
      const used = new Set(this.slots.values());
      const i = this.pool.findIndex((_, n) => !used.has(n));
      if (i < 0) return null;
      this.slots.set(k, i);
    }
    return this.pool[this.slots.get(k)];
  }

  itemForSlot(i) {
    for (const [k, n] of this.slots) if (n === i) return this.items.find(r => keyOf(r) === k) ?? null;
    return null;
  }

  free(k) {
    const i = this.slots.get(k);
    if (i === undefined) return;
    this.pool[i].set_value("");
    this.slots.delete(k);
  }

  done(r, cx, message) {
    this.items = this.items.filter(x => keyOf(x) !== keyOf(r));
    this.free(keyOf(r));
    this.errors.delete(keyOf(r));
    if (message) notify(message);
    this.busy = null; this.armed = null;
    cx.notify();
  }

  fail(r, e, cx) {
    this.errors.set(keyOf(r), String(e?.message ?? e).replace(/^herdr-pr: /, ""));
    notify({title:"Request could not be completed",body:"Open Waiting for you for details and retry.",level:"error"});
    this.busy = null;
    cx.notify();
  }

  // Merges with the person's own gh, on the machine where the PR panel found it signed in.
  merge(r, cx) {
    const k = keyOf(r), risky = r.risk === "high" || r.risk === "critical";
    if (this.busy) return;
    if (risky && this.armed !== k) {
      this.armed = k; cx.notify();
      cx.timer.after(5000, cx => { if (this.armed === k) { this.armed = null; cx.notify(); } });
      return;
    }
    this.busy = k; this.armed = null; cx.notify();
    cx.spawn(async cx => {
      const ghOn = shared("pr-hub.gh") || undefined;
      try {
        let head = r.head;
        if (!head) {
          const v = await exec("gh", ["pr", "view", r.url, "--json", "headRefOid"], { on: ghOn });
          if (v.code !== 0) throw new Error(String(v.stderr).trim() || "gh pr view failed");
          head = JSON.parse(v.stdout).headRefOid;
        }
        const m = await exec("gh", ["pr", "merge", r.url, `--${r.method || "squash"}`, "--match-head-commit", head], { on: ghOn });
        if (m.code !== 0) {
          const why = String(m.stderr).trim() || "gh pr merge failed";
          await herdrPr(["answer", r.id, "failed", "--message", why.slice(0, 300)], r.machine).catch(() => {});
          throw new Error(why);
        }
        await herdrPr(["answer", r.id, "merged", "--message", `merged (${r.method || "squash"}) by you in Herdr`], r.machine);
        this.done(r, cx, { title: `Merged ${r.repo}#${r.number}`, body: r.title || r.url, level: "success", timeout: 8000 });
      } catch (e) { this.fail(r, e, cx); }
    });
  }

  decline(r, cx) {
    if (this.busy) return;
    this.busy = keyOf(r); cx.notify();
    cx.spawn(async cx => {
      const args = r.kind === "pr" ? ["answer", r.id, "declined", "--message", "declined by you in Herdr"] : ["secret-decline", r.id];
      const res = await herdrPr(args, r.machine).catch(e => ({ code: 1, stderr: String(e) }));
      if (res.code !== 0) this.fail(r, res.stderr, cx);
      else this.done(r, cx, null);
    });
  }

  fill(r, cx) {
    const input = this.slotFor(r);
    if (this.busy || !input || !input.value()) return;
    const value = input.value();
    this.busy = keyOf(r); cx.notify();
    cx.spawn(async cx => {
      const res = await herdrPr(["secret-fill", r.id, b64(value)], r.machine).catch(e => ({ code: 1, stderr: String(e) }));
      if (res.code !== 0) this.fail(r, res.stderr, cx);
      else this.done(r, cx, { title: `Saved ${r.key}`, body: `${r.file} on ${name(r.machine)}`, level: "success", timeout: 6000 });
    });
  }

  riskColor(risk, t) {
    return { critical: t.danger, high: t.warning, medium: t.accent, low: t.dim }[risk] ?? t.accent;
  }

  button(id, label, onClick, t, { solid = false, color = null } = {}) {
    return bevel(h_flex().id(id).h(28).px(10).flex_none().items_center(),solid).text_size(11)
      .text_color(solid ? t.accent : color ?? t.muted).hover(s => s.opacity(.85))
      .when(Boolean(this.busy), el => el.opacity(.55))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  prCard(r, t) {
    const k = keyOf(r), color = this.riskColor(r.risk, t), busy = this.busy === k, armed = this.armed === k, err = this.errors.get(k);
    const showTesting = this.open.has(k);
    return requestFrame(v_flex().id(`inbox-${k}`).w_full().flex_none().p(10).gap(7))
      .child(h_flex().w_full().gap(6).items_center()
        .child(svg("mods/pr-hub/merge.svg").size(14).flex_none().text_color(t.warning))
        .child(div().flex_1().text_size(9).font_semibold().text_color(t.muted).child("MERGE REQUEST"))
        .child(div().px(5).py(2).border_l(2).border_color(color).bg(t.raised).text_color(color).text_size(9).font_semibold().child((r.risk || "medium").toUpperCase())))
      .child(div().w_full().text_size(13).font_semibold().text_color(t.foreground).child(r.title || `${r.repo}#${r.number}`))
      .child(h_flex().w_full().gap(4).flex_wrap().items_center()
        .child(div().text_size(10.5).text_color(t.muted).child(`${r.repo.split("/")[1]} #${r.number} · ${r.method || "squash"} · ${r.by} · ${name(r.machine)}`))
        .children((r.areas ?? []).map(a => div().px(5).py(2).border_l(1).border_color(t.secondary).bg(t.raised).text_size(9).text_color(t.secondary).child(a))))
      .when(Boolean(r.note), el => el.child(div().w_full().text_size(12).line_height(1.25).text_color(t.muted).child(r.note)))
      .when(Boolean(r.testing) && showTesting, el => el.child(v_flex().w_full().p(8).gap(4).border_l(1).border_color(t.edge).bg(t.background)
        .child(div().text_size(10.5).font_medium().text_color(t.accent).child("MANUAL TESTING"))
        .child(div().w_full().text_size(11.5).text_color(t.foreground).child(r.testing))))
      .child(div().w_full().h(1).bg(t.border))
      .child(h_flex().gap(5).items_center().flex_wrap()
        .child(this.button(`merge-${k}`, busy ? "Merging…" : armed ? `Confirm ${r.risk} merge` : "Merge", cx => this.merge(r, cx), t, { solid: !armed, color: t.ansi1 }))
        .child(this.button(`decline-${k}`, "Decline", cx => this.decline(r, cx), t, { color: t.ansi1 }))
        .when(Boolean(r.testing), el => el.child(this.button(`testing-${k}`, showTesting ? "Hide testing" : "Testing steps", cx => { showTesting ? this.open.delete(k) : this.open.add(k); cx.notify(); }, t, { color: t.accent })))
        .when(!r.testing, el => el.child(div().text_size(10.5).text_color(t.blocked).child("no testing steps")))
        .child(this.button(`gh-${k}`, "GitHub ↗", () => openExternal(r.url), t)))
      .when(Boolean(err), el => el.child(div().w_full().pl(7).border_l(2).border_color(t.ansi1).text_size(11).text_color(t.ansi1).child(err)));
  }

  secretCard(r, t) {
    const k = keyOf(r), busy = this.busy === k, err = this.errors.get(k), input = this.slotFor(r);
    return requestFrame(v_flex().id(`inbox-${k}`).w_full().flex_none().p(10).gap(7))
      .child(h_flex().w_full().min_w(0).gap(8).items_center()
        .child(div().relative().size(30).flex_none().flex().items_center().justify_center()
          .child(fitting("badge",30,30,{accent:t.warning}).absolute())
          .child(svg("mods/neon-inbox/art/key.svg").size(16).text_color(t.warning)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(9).font_semibold().text_color(t.warning).child("SECRET INPUT"))
          .child(div().w_full().truncate().tooltip(r.key).text_size(13).font_semibold().text_color(t.foreground).child(r.key))))
      .child(div().w_full().truncate().text_size(10.5).text_color(t.accent).tooltip(r.file).child(`→ ${r.file}`))
      .child(div().text_size(10).text_color(t.dim).child(`${name(r.machine)} · ${r.by}${r.exists ? "" : " · creates the file"}`))
      .when(Boolean(r.note), el => el.child(div().w_full().text_size(12).line_height(1.25).text_color(t.muted).child(r.note)))
      .child(bevel(h_flex().id(`in-${k}`).w_full().min_w(0).h(34).px(10).gap(7).items_center()).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(svg("mods/neon-inbox/art/key.svg").size(12).flex_none().text_color(t.dim))
          .when(Boolean(input), el => el.child(Input.new(input).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))))
      .child(h_flex().w_full().gap(6).items_center().flex_wrap()
        .child(div().flex_1().min_w(0).text_size(9).text_color(t.dim).child("Masked input"))
        .child(this.button(`save-${k}`, busy ? "Saving…" : "Save", cx => this.fill(r, cx), t, { solid: true }))
        .child(this.button(`no-${k}`, "Decline", cx => this.decline(r, cx), t, { color: t.ansi1 })))
      .when(Boolean(err), el => el.child(div().w_full().pl(7).border_l(2).border_color(t.ansi1).text_size(11).text_color(t.ansi1).child(err)));
  }

  render() {
    if (!this.items.length) return div();
    const t = skin(), side = placement()?.vertical;
    const counts = this.items.reduce((c, r) => { c[r.kind] = (c[r.kind] ?? 0) + 1; return c; }, {});
    const label = [counts.pr ? `${counts.pr} merge${counts.pr > 1 ? "s" : ""}` : null, counts.secret ? `${counts.secret} secret${counts.secret > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
    const top = this.items[0], topColor = top.kind === "secret" ? t.blocked : this.riskColor(top.risk, t);
    const header = h_flex().id("inbox-head").relative().w_full().h(44).flex_none().px(10).gap(9).items_center().bg(t.chrome).cursor_pointer()
      .child(div().absolute().top(0).left(14).right(14).h(1).bg(t.rail))
      .child(div().absolute().top(0).left(14).w(32).h(2).bg(topColor))
      .on_click((_e, cx) => { this.collapsed = !this.collapsed; cx.notify(); })
      .child(div().relative().size(26).flex_none().flex().items_center().justify_center()
        .child(fitting("badge",26,26,{accent:topColor}).absolute())
        .child(svg("mods/neon-inbox/art/request.svg").size(13).text_color(topColor)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Waiting for you"))
        .child(div().truncate().text_size(9).text_color(t.muted).child(label)))
      .child(svg(`mods/neon-inbox/art/chevron-${this.collapsed ? "up" : "down"}.svg`).size(12).flex_none().text_color(t.accent));
    if (this.collapsed) return v_flex().w(side ? 260 : 300).rounded(8).overflow_hidden().border_1().border_color(t.edge).child(header);
    return v_flex().id("inbox").w(side ? 340 : 400).max_h(520).rounded(8).overflow_hidden().bg(t.background).border_1().border_color(t.edge).text_color(t.foreground).text_size(12.5)
      .child(header)
      .child(v_flex().id("inbox-list").w_full().max_h(474).overflow_y_scrollbar().p(8).gap(8)
        .children(this.items.map(r => r.kind === "secret" ? this.secretCard(r, t) : this.prCard(r, t))));
  }
}
