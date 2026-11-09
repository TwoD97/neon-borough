import {notify, emitSound} from "./notifications.js";
import { skin, art, artText } from "./theme-tokens.js";
import { approvalFrame } from "./approval-skin.js";
import { bevel } from "./controls.js";
import { panelSkin } from "./panel-skin.js";
import { compactBadges } from "./badges.js";
import { cardActivity, isActiveCard } from "./card-activity.js";
// PR Hub: pull requests your agents opened, your own, and those waiting for your review, with
// their CI and the deploy workflows that run after a merge. Built on pr-flow by jjangsky (MIT,
// LICENSE.pr-flow) with controls added: merge, auto-merge, draft/ready, update branch, approve,
// comment, close/reopen, re-run, delete branch, and scheduled merges. herdr-pr (this folder) runs
// them on the machines picked in Settings > Scheduled merges: cron on Linux/macOS, Task Scheduler
// on Windows. An always-on server keeps merging with this PC off. See scheduler.js.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, TextView, v_virtual_list, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { agents, panes, spaces, machines, focused, exec, run, theme, props, settings, shared, setShared, nextCommand, openOverlay, layout, window as appWindow} from "herdr";
import { MERGE_METHODS, createGh, parseRemote, runIdFromUrl } from "./gh.js";
import { createTracker } from "./tracker.js";
import { translator, relative, effectiveLang } from "./i18n.js";
import { facts, steps, openThreads, logTail, flowLine, flowRows, jobSteps, issueState, issueLabel, orgsOf, byOrg, reposOf, byRepo } from "./present.js";
import { parseDiff, commentTarget, withComments } from "./diff.js";
import { parseDuration, sanitize } from "./text.js";
import { LOCAL, keyName, candidates, schedConfig, useScheduler, setDefaultScheduler, sched, schedStatus, installScheduler, removeScheduler, readOutbox, dropOutbox, readAsks, answerAsk } from "./scheduler.js";

const MOD = "pr-hub";
const VIEW_KEY = "pr-hub.view";
const LANG_KEY = "pr-hub.lang";
const GH_KEY = "pr-hub.gh"; // the machine where gh is signed in ("" = this PC)
const TICK_MS = 5000;
const FILES_FOLD_AT = 10; // more changed files than this start folded

const icon = (name, size, color) => svg(`mods/${MOD}/${name}.svg`).size(size).flex_none().text_color(color);
const toneColor = (t, tone) => ({ ok: t.ansi2, bad: t.ansi1, warn: t.blocked, wait: t.foreground, run: t.working, merge: t.ansi2, merged: t.ansi5, dim: t.dim, comment: t.muted, todo: t.dim }[tone] ?? t.muted);
const mono = () => settings().font_family ?? "JetBrains Mono";

function factIcon(tone, t) {
  const c = toneColor(t, tone);
  if (tone === "ok") return icon("check", 12, c);
  if (tone === "bad") return icon("cross", 12, c);
  if (tone === "run") return icon("spinner", 11, c).spin(900);
  if (tone === "comment" || tone === "warn") return icon("comment", 12, c);
  if (tone === "merge" || tone === "merged") return icon("merge", 12, c);
  return icon("pending", 10, c);
}
const fact = (f, t) => h_flex().flex_none().gap(4).items_center().child(factIcon(f.tone, t))
  .child(div().text_size(12).text_color(f.tone === "ok" || f.tone === "comment" ? t.muted : toneColor(t, f.tone)).child(f.label));

function agentDot(status, t) {
  if (status === "working") return icon("spinner", 11, t.working).spin(900);
  const color = status === "blocked" ? t.blocked : status === "done" ? t.done : t.dim;
  return div().size(7).mx(2).flex_none().rounded(99).bg(color);
}

function stepMark(tone, t) {
  const c = toneColor(t, tone);
  const round = (el) => h_flex().size(20).flex_none().rounded(99).bg(c).items_center().justify_center().child(el);
  if (tone === "ok") return round(icon("check", 12, t.background));
  if (tone === "bad") return round(icon("cross", 12, t.background));
  if (tone === "warn") return round(icon("comment", 11, t.background));
  const box = h_flex().size(20).flex_none().items_center().justify_center();
  if (tone === "run") return box.child(icon("spinner", 15, c).spin(900));
  if (tone === "wait") return box.child(div().size(12).rounded(99).border_2().border_color(c));
  return box.child(div().size(9).rounded(99).border_1().border_color(t.dim));
}

function fileLine(path) {
  const parts = String(path).split("/"), name = parts.pop();
  return { dir: parts.length ? parts.join("/") + "/" : "", name };
}

function openExternal(url) {
  const platform = appWindow()?.platform;
  const [cmd, args] = platform === "macos" ? ["open", [url]] : platform === "windows" ? ["explorer.exe", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => {});
}

// Scheduled merges: herdr-pr on the scheduler machines does the work (scheduler.js).
const SCHED_MS = 20_000;
// The inbox mod (neon-inbox) is the one poller for asks and queued requests when the layout has it.
function inboxInLayout() {
  const has = (n) => !!n && (n.content?.mod === "neon-inbox" || (n.floating ?? []).some((f) => f.content?.mod === "neon-inbox") || (n.children ?? []).some(has));
  try { return has(layout()); } catch { return false; }
}
const active = (x) => x && (x.state === "scheduled" || x.state === "waiting");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");
function when(sec) {
  const d = new Date(sec * 1000), now = new Date(), next = new Date(now.getTime() + 86_400_000);
  const day = d.toDateString() === now.toDateString() ? "today" : d.toDateString() === next.toDateString() ? "tomorrow" : `${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// An app started from the Finder has no LANG, so ask macOS too.
const LOCALE = 'l="${LC_ALL:-${LC_MESSAGES:-$LANG}}"; case "$l" in ""|C|C.*|POSIX) l=$(defaults read -g AppleLocale 2>/dev/null);; esac; printf %s "$l"';
const systemLang = () => exec("sh", ["-c", LOCALE]).then((r) => (/^ko/i.test(r.stdout) ? "ko" : "en")).catch(() => "en");

function agentList() {
  const allPanes = panes(), allSpaces = spaces();
  return agents().map((a) => {
    const pane = allPanes.find((p) => p.terminal === a.address);
    return {
      address: a.address, status: a.status, app: a.program?.name ?? a.app ?? "Agent", name: a.space_name || a.tab_name || "",
      cwd: pane?.cwd ?? null, branch: pane?.branch ?? null, on: allSpaces.find((s) => s.id === a.space)?.machine ?? null,
    };
  });
}

export default class PrFlow extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.viewer = p.screen === "viewer";
    this.system = localStorage.getItem("lang") ?? "en";
    this.useLang();
    this.handle = cx.focus_handle();
    this.scroll = null;
    cx.spawn(async (cx) => {
      const system = await systemLang();
      if (system !== this.system) { this.system = system; localStorage.setItem("lang", system); cx.notify(); }
    });
    if (this.viewer) {
      this.loaded = null; this.file = 0;
      this.threads = []; this.head = null;
      this.composing = null; // { path, line, side }: the line being commented on
      this.sending = false; this.commentError = null;
      this.commentInput = TextareaState.new({ rows: 3, placeholder: this.t("comment_placeholder") });
      return;
    }

    this.ghOn = localStorage.getItem("gh-on"); // null until found
    if (this.ghOn !== null) setShared(GH_KEY, this.ghOn);
    this.gh = createGh((cmd, args, o = {}) => exec(cmd, args, { ...o, on: this.ghOn || undefined }));
    this.tracker = createTracker({
      gh: this.gh,
      settings: {
        pollMs: Math.max(10_000, Number(p.poll_seconds) * 1000 || 30_000),
        ciWaitMs: parseDuration(p.ci_wait, 120_000),
        aiChecks: (Array.isArray(p.ai_checks) ? p.ai_checks : []).map((x) => String(x).toLowerCase()),
        mine: p.mine !== false,
      },
      remoteOf: async (cwd, on) => {
        const r = await exec("git", ["--no-optional-locks", "remote", "get-url", "origin"], { cwd, on: on ?? undefined });
        return r.code === 0 ? parseRemote(r.stdout) : null;
      },
      store: {
        load: () => { try { return JSON.parse(localStorage.getItem("tracked") ?? "{}"); } catch { return {}; } },
        save: (data) => localStorage.setItem("tracked", JSON.stringify(data)),
      },
    });
    this.url = null; // the open PR; null shows the list
    this.inboxView = localStorage.getItem("inbox-view") === "requests" ? "requests" : "pulls";
    this.selected = 0;
    this.org = localStorage.getItem("org") || null; // the owner the list shows; null: all
    this.repo = localStorage.getItem("repo") || null; // within it, one repo; null: all of the owner's
    this.logs = new Map(); // run id -> { name, runId, repo, tail, full, failed }
    this.opened = new Set(); // timeline rows showing their steps or checks
    this.filesFold = new Map(); // url -> whether the changed files are showing, once you chose
    this.issueUrl = null; // the issue open in the panel
    this.issueData = new Map(); // url -> issue, or { failed: true }
    this.ghReady = true;
    this.busy = false;
    // The merge button, only with the `merge` prop ("squash", "merge" or "rebase"). The first press
    // arms it for a few seconds, the second merges.
    this.mergeMethod = MERGE_METHODS.includes(p.merge) ? p.merge : null;
    this.mergeArmed = null; // url
    this.merging = null; // url
    this.mergeError = null; // { url, message }
    this.tick(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    cx.timer.every(60_000, (cx) => cx.notify()); // "5분 전" moves on
    cx.spawn(async (cx) => {
      this.ghReady = await this.findGh();
      this.tick(cx);
      cx.notify();
    });
    // Controls and scheduling.
    this.method = localStorage.getItem("method") || "squash";
    this.schedules = []; this.schedSeen = null; this.schedError = null; this.schedSig = "";
    this.ownAsks = []; this.asksSeen = null; this.asksSig = ""; this.answering = null; this.askError = null;
    // Pending merge asks: the inbox mod polls every machine and shares them (herdr.requests);
    // without an inbox in the layout this panel polls them itself (ownAsks).
    Object.defineProperty(this, "asks", { get: () => (inboxInLayout() ? (shared("herdr.requests")?.asks ?? []) : this.ownAsks), set: () => {} });
    this.whenInput = InputState.new({ placeholder: "tomorrow 09:00 · in 2h · 2026-11-20 14:00" });
    this.whenInput.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.whenInput.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.whenInput.on("submit", (_e, cx) => { const c = this.current(); if (c) this.submitSchedule(c, cx); });
    this.lockHead = true; this.scheduling = false; this.formError = null;
    this.note = TextareaState.new({ rows: 3, placeholder: "Comment on this PR" });
    this.note.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.note.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.commenting = null; this.busyAct = null; this.armed = null; this.actError = null; this.actOk = null;
    this.loadSchedules(cx);
    cx.timer.every(SCHED_MS, (cx) => this.loadSchedules(cx));
    // "pr-hub.next" and friends, for keys.json and the command line.
    cx.spawn(async (cx) => {
      for (;;) { const c = await nextCommand(); this.command(c, cx); cx.notify(); }
    });
  }

  // gh may be signed in on another machine only: ask each until one answers.
  async findGh() {
    const order = [this.ghOn, schedConfig().default, "", ...machines().map((m) => m.name ?? "")].filter((m, i, a) => m !== null && a.indexOf(m) === i);
    for (const m of order) {
      const r = await exec("gh", ["auth", "status"], { on: m || undefined }).catch(() => null);
      if (r?.code === 0) { this.ghOn = m; localStorage.setItem("gh-on", m); setShared(GH_KEY, m); return true; }
    }
    return false;
  }

  loadSchedules(cx) {
    if (this.schedBusy) return;
    this.schedBusy = true;
    cx.spawn(async (cx) => {
      const cfg = schedConfig(), all = [], errors = [];
      try {
        const inbox = inboxInLayout();
        if (!inbox) await this.forwardOutboxes(cfg).catch(() => {});
        // Every scheduler at once (each remote call is a round trip over ssh).
        const lists = await Promise.all(cfg.machines.map((key) => sched(["list", "--json", "--all"], key)
          .then((r) => ({ key, r }), (e) => ({ key, r: { code: 1, stderr: String(e?.message ?? e) } }))));
        for (const { key, r } of lists) {
          try {
            if (r.code !== 0) throw new Error(String(r.stderr).trim().replace(/^herdr-pr: /, "") || "herdr-pr failed");
            // A machine that isn't set up as a scheduler lists its outbox instead: skip those rows.
            for (const i of JSON.parse(r.stdout)) if (i && i.state && i.at) all.push({ ...i, machine: key });
          } catch (e) {
            errors.push(`Scheduler on ${keyName(key)}: ${sanitize(e.message)}`);
          }
        }
        this.announce(all);
        if (!inbox) {
          const live = new Set(machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name));
          const keys = candidates().filter((key) => key === LOCAL || live.has(key));
          const asks = (await Promise.all(keys.map((key) => readAsks(key).catch(() => [])))).flat();
          this.announceAsks(asks);
          const asksSig = JSON.stringify(asks);
          if (asksSig !== this.asksSig) { this.asksSig = asksSig; this.ownAsks = asks; cx.notify(); }
        }
        // Pending requests need GitHub's actual source/base refs, even when the
        // PR was not already discovered in the account list. The tracker only reads.
        for (const request of this.asks) if (request.state === "pending") this.tracker.track(request.url);
        const sig = JSON.stringify(all), err = errors.join(" · ") || null;
        if (sig !== this.schedSig || err !== this.schedError) { this.schedSig = sig; this.schedules = all; this.schedError = err; cx.notify(); }
      } finally { this.schedBusy = false; }
    });
  }

  // A toast when a scheduled merge goes through or gives up.
  announce(list) {
    const before = this.schedSeen, keyOf = (i) => `${i.machine}:${i.id}`;
    this.schedSeen = new Map(list.map((i) => [keyOf(i), i.state]));
    if (!before) return;
    for (const i of list) {
      const was = before.get(keyOf(i));
      if (!was || was === i.state || (i.state !== "merged" && i.state !== "failed")) continue;
      notify({ title: i.state === "merged" ? `Merged ${i.repo}#${i.number}` : `Scheduled merge failed: ${i.repo}#${i.number}`,
        body: `${sanitize(i.title)}${i.message ? ` · ${sanitize(i.message)}` : ""}`, level: i.state === "merged" ? "success" : "error", timeout: 12000 });
      if (this.tracker) this.tracker.refresh(i.url);
    }
  }

  // Agents on machines that aren't schedulers queue requests in ~/.herdr/pr-outbox/; this hands
  // them to the default scheduler.
  async forwardOutboxes(cfg) {
    const target = cfg.default;
    if (target === null) return;
    const live = new Set(machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name));
    for (const key of candidates()) {
      if (cfg.machines.includes(key) || (key !== LOCAL && !live.has(key))) continue;
      const queued = await readOutbox(key).catch(() => []);
      for (const q of queued) {
        if (!q || !q.id) continue;
        const args = q.op === "cancel" ? ["cancel", String(q.ref)]
          : ["schedule", String(q.url), "--at", `@${q.at}`, "--method", String(q.method), "--by", `${q.by} via ${keyName(key)}`, ...(q.any_head ? ["--any-head"] : []), ...(q.note ? ["--note", String(q.note)] : [])];
        const res = await sched(args, target).catch((e) => ({ code: 1, stderr: e.message }));
        if (res.code !== 0) notify({ title: "A PR schedule from an agent failed", body: `${keyName(key)}: ${sanitize(res.stderr).trim().replace(/^herdr-pr: /, "")}`, level: "error", timeout: 12000 });
        else notify({ title: q.op === "cancel" ? "Scheduled merge cancelled" : "Merge scheduled by an agent", body: `${q.url ?? q.ref} · ${keyName(key)} → ${keyName(target)}`, level: "info", timeout: 8000 });
        await dropOutbox(key, q.id);
      }
    }
  }

  // Where the next merge from the form runs: the one picked there, else the default scheduler.
  schedTarget() {
    const cfg = schedConfig();
    return this.schedOn != null && cfg.machines.includes(this.schedOn) ? this.schedOn : cfg.default;
  }

  // A toast and the attention sound when an agent asks for a merge.
  announceAsks(asks) {
    const pending = asks.filter((a) => a.state === "pending"), before = this.asksSeen;
    this.asksSeen = new Set(pending.map((a) => `${a.machine}:${a.id}`));
    if (!before) return;
    const fresh = pending.filter((a) => !before.has(`${a.machine}:${a.id}`));
    if (shared("pr-hub.request-notifications") !== false) {
      for (const a of fresh) notify({ title: "An agent asks you to merge", body: `${a.repo}#${a.number}${a.title ? ` · ${sanitize(a.title)}` : ""} · ${sanitize(a.by)}`, level: "warning", timeout: 10000 }, {sound:false});
    }
    if (fresh.length && shared("pr-hub.request-sound") !== false) emitSound("warning");
  }

  // Merge with your own gh: the agent never needs merge rights. A pinned commit must still be the head.
  answerAskWith(a, merge, cx) {
    if (this.answering) return;
    this.answering = a.id; this.askError = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (merge) {
          const head = a.head ?? await this.gh.fetchHead(a.url);
          try { await this.gh.merge(a.url, a.method, head); }
          catch (e) { await answerAsk(a.machine, a.id, "failed", sanitize(e.message)).catch(() => {}); throw e; }
          await answerAsk(a.machine, a.id, "merged", `merged (${a.method}) by you in Herdr`);
          notify({ title: `Merged ${a.repo}#${a.number}`, body: sanitize(a.title || a.url), level: "success", timeout: 8000 });
          if (this.tracker) this.tracker.refresh(a.url);
        } else {
          await answerAsk(a.machine, a.id, "declined", "declined by you in Herdr");
        }
      } catch (e) {
        this.askError = { id: a.id, text: sanitize(String(e?.message ?? e)) };
      }
      this.answering = null;
      this.loadSchedules(cx);
      cx.notify();
    });
  }

  askRows(t) {
    const pending = this.asks.filter((a) => a.state === "pending").sort((x, y) => x.created - y.created);
    if (!pending.length) return null;
    return v_flex().w_full().min_w(0).flex_none().gap(8).pb(6)
      .child(h_flex().h(25).px(3).gap(7).items_center()
        .child(div().w(3).h(13).bg(skin().warning))
        .child(div().text_size(10).font_semibold().text_color(skin().warning).child("WAITING FOR YOUR OK"))
        .child(div().flex_1())
        .child(div().text_size(10).text_color(skin().muted).child(String(pending.length))))
      .children(pending.map((a) => {
        const busy = this.answering === a.id, err = this.askError?.id === a.id ? this.askError.text : null;
        const pr = this.tracker.cards().find(card => card.url === a.url)?.pr;
        const branch = (label, value, color) => h_flex().w_full().min_w(0).gap(7).items_start()
          .child(div().w(42).flex_none().text_size(10).text_color(skin().dim).child(label))
          .child(div().flex_1().min_w(0).whitespace_normal().text_size(12).text_color(color).child(sanitize(value || "Loading…")));
        const btn = (id, label, color, fn, solid) => bevel(h_flex().id(id).h(30).px(10).gap(5).flex_none().items_center(), solid)
          .text_size(11).text_color(solid ? skin().accent : color).hover(s => s.opacity(.85))
          .when(Boolean(this.answering) && !id.startsWith("ask-open-"), el => el.opacity(.5))
          .on_click((_e, cx) => fn(cx))
          .child(icon(solid ? "merge" : id.startsWith("ask-decline-") ? "cross" : "external",11,solid ? skin().accent : color)).child(label);
        return approvalFrame(v_flex().id(`ask-${a.machine || "local"}-${a.id}`).w_full().flex_none().p(12).gap(8))
          .child(h_flex().w_full().min_w(0).gap(8).items_center()
            .child(div().w(25).h(25).flex_none().flex().items_center().justify_center().bg(skin().metal).border_l(2).border_color(skin().warning).child(icon("merge",14,skin().warning)))
            .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(skin().foreground).child(sanitize(a.title || `${a.repo}#${a.number}`))))
          .child(h_flex().w_full().min_w(0).gap(7).flex_wrap().items_center()
            .child(div().text_size(11).text_color(skin().accent).child(`${a.repo} #${a.number}`))
            .child(div().text_size(10).text_color(skin().muted).child(a.method))
            .when(Boolean(a.head), el => el.child(div().text_size(10).text_color(skin().muted).tooltip(`Only this commit can be merged: ${a.head}`).child(`Commit ${a.head.slice(0,7)}`))))
          .child(div().w_full().text_size(10).text_color(skin().dim).child(`Asked by ${sanitize(a.by)} · ${keyName(a.machine)}`))
          .child(v_flex().w_full().min_w(0).gap(4).pl(9).border_l(2).border_color(skin().edge)
            .child(branch("FROM", pr?.headRefName, skin().accent))
            .child(branch("INTO", pr?.baseRefName, skin().secondary)))
          .when(Boolean(a.note), e => e.child(v_flex().w_full().min_w(0).pl(9).gap(4).border_l(1).border_color(skin().warning)
            .child(div().text_size(9).text_color(skin().warning).child("REASON"))
            .child(div().w_full().text_size(12).line_height(1.3).text_color(skin().foreground).child(sanitize(a.note)))))
          .child(div().h(1).w_full().bg(skin().border))
          .child(h_flex().w_full().min_w(0).gap(6).flex_wrap().items_center()
            .child(btn(`ask-merge-${a.id}`, busy ? "Merging…" : `Merge (${a.method})`, t.foreground, (cx) => this.answerAskWith(a, true, cx), true))
            .child(btn(`ask-decline-${a.id}`, "Decline", t.ansi1, (cx) => this.answerAskWith(a, false, cx), false))
            .child(btn(`ask-open-${a.id}`, "Open", t.muted, (cx) => { this.tracker.track(a.url); this.openPr(a.url, cx); cx.spawn(async (cx) => { await this.tracker.refresh(a.url); cx.notify(); }); }, false)))
          .when(Boolean(err), (e) => e.child(div().pl(8).border_l(2).border_color(t.ansi1).text_size(11.5).text_color(t.ansi1).child(err)));
      }));
  }

  scheduleFor(url) {
    const mine = this.schedules.filter((x) => x.url === url);
    return mine.find(active) ?? mine.sort((a, b) => b.updated - a.updated)[0] ?? null;
  }

  submitSchedule(card, cx) {
    const at = this.whenInput.value().trim();
    if (!at || this.scheduling) return;
    const target = this.schedTarget();
    if (target === null) { this.formError = "No scheduler yet: set one up in Settings (gear icon)."; cx.notify(); return; }
    this.scheduling = true; this.formError = null; cx.notify();
    cx.spawn(async (cx) => {
      const r = await sched(["schedule", card.url, "--at", at, "--method", this.method, "--by", "you in Herdr", ...(this.lockHead ? [] : ["--any-head"])], target)
        .catch((e) => ({ code: 1, stderr: e.message }));
      this.scheduling = false;
      if (r.code !== 0) this.formError = sanitize(r.stderr).trim().replace(/^herdr-pr: /, "");
      else this.whenInput.set_value("");
      this.loadSchedules(cx);
      cx.notify();
    });
  }

  cancelSchedule(item, cx) {
    cx.spawn(async (cx) => { await sched(["cancel", item.id], item.machine ?? schedConfig().default).catch(() => {}); this.loadSchedules(cx); });
  }

  // One control at a time. Risky ones (merge, close, delete branch) need a second press within 4 s.
  act(card, key, label, fn, cx, risky = false) {
    const id = `${card.url}:${key}`;
    if (this.busyAct) return;
    if (risky && this.armed !== id) {
      this.armed = id; this.actError = null; this.actOk = null;
      cx.timer.after(4000, (cx) => { if (this.armed === id) { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.armed = null; this.busyAct = id; this.actError = null; this.actOk = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await fn();
        this.actOk = { url: card.url, text: label };
        await this.tracker.refresh(card.url);
      } catch (e) {
        this.actError = { url: card.url, text: sanitize(e.message) };
      }
      this.busyAct = null;
      cx.notify();
    });
  }

  controls(card, t) {
    const pr = card.pr, url = card.url, gh = this.gh, open = pr.state === "OPEN";
    const btn = (key, label, fn, { risky = false, tone = null, armedLabel = null } = {}) => {
      const id = `${url}:${key}`, armed = this.armed === id, busy = this.busyAct === id, c = tone ?? t.ansi2;
      return h_flex().id(`act-${key}`).h(28).px(10).gap(5).flex_none().items_center().rounded(7).text_size(12).cursor_pointer()
        .bg(armed ? c : t.raised).text_color(armed ? t.background : tone && !armed ? tone : t.foreground)
        .border_1().border_color(armed ? c : t.border).hover((st) => st.border_color(t.input))
        .on_click((_e, cx) => this.act(card, key, label, fn, cx, risky))
        .when(busy, (e) => e.child(icon("spinner", 11, t.working).spin(900)))
        .child(armed ? (armedLabel ?? "Press again") : label);
    };
    const toggle = (key, label, on, flip) => h_flex().id(`act-${key}`).h(28).px(10).flex_none().items_center().rounded(7).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.raised).border_1().border_color(on ? t.input : t.border).hover((st) => st.border_color(t.input))
      .on_click((_e, cx) => { flip(); cx.notify(); }).child(label);
    const failedRun = runIdFromUrl(card.status?.ci?.failed?.[0]?.url);
    const buttons = [];
    if (open) {
      if (!pr.isDraft) buttons.push(btn("merge", "Merge now", () => gh.merge(url, this.method, pr.headRefOid), { risky: true, armedLabel: `Press again: ${this.method} → ${pr.baseRefName}` }));
      buttons.push(pr.autoMergeRequest ? btn("auto-off", "Cancel auto-merge", () => gh.autoMergeOff(url)) : btn("auto", "Auto-merge when green", () => gh.autoMerge(url, this.method)));
      buttons.push(pr.isDraft ? btn("ready", "Ready for review", () => gh.ready(url)) : btn("draft", "Back to draft", () => gh.draft(url)));
      if (pr.mergeStateStatus === "BEHIND") buttons.push(btn("update", "Update branch", () => gh.updateBranch(url)));
      if (card.review) buttons.push(btn("approve", "Approve", () => gh.approve(url)));
      if (failedRun) buttons.push(btn("rerun", "Re-run failed checks", () => gh.rerunFailed(card.repo, failedRun)));
      buttons.push(toggle("comment", "Comment", this.commenting === url, () => { this.commenting = this.commenting === url ? null : url; if (this.commenting) this.note.focus(); }));
      buttons.push(btn("close", "Close", () => gh.close(url), { risky: true, tone: t.ansi1, armedLabel: "Press again to close" }));
    } else if (pr.state === "CLOSED") {
      buttons.push(btn("reopen", "Reopen", () => gh.reopen(url)));
    } else if (pr.state === "MERGED") {
      buttons.push(btn("delete-branch", `Delete branch ${pr.headRefName}`, () => gh.deleteBranch(card.repo, pr.headRefName), { risky: true, tone: t.ansi1, armedLabel: "Press again to delete" }));
      buttons.push(toggle("comment", "Comment", this.commenting === url, () => { this.commenting = this.commenting === url ? null : url; if (this.commenting) this.note.focus(); }));
    }
    const methods = h_flex().gap(3).items_center().child(div().pr(3).text_size(11.5).text_color(t.dim).child("Merge as"))
      .children(MERGE_METHODS.map((m) => div().id(`m-${m}`).px(8).h(22).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
        .bg(this.method === m ? t.selected : t.background).text_color(this.method === m ? t.foreground : t.dim).border_1().border_color(this.method === m ? t.input : t.border)
        .on_click((_e, cx) => { this.method = m; localStorage.setItem("method", m); cx.notify(); }).child(m)));
    const sendComment = (cx) => {
      const body = this.note.value().trim();
      if (!body) return;
      this.act(card, "send", "Comment sent", async () => { await gh.prComment(url, body); this.note.set_value(""); this.commenting = null; }, cx);
    };
    return v_flex().w_full().gap(8)
      .when(open, (e) => e.child(methods))
      .child(h_flex().w_full().flex_wrap().gap(6).children(buttons))
      .when(Boolean(pr.autoMergeRequest), (e) => e.child(div().text_size(11.5).text_color(t.working).child(`Auto-merge is on (${String(pr.autoMergeRequest.mergeMethod ?? "").toLowerCase()}): GitHub merges once checks and reviews pass.`)))
      .when(this.commenting === url, (e) => e.child(v_flex().w_full().gap(6)
        .on_key_down((ev, cx) => { if (ev.key === "enter" && (ev.modifiers?.control || ev.modifiers?.platform)) { sendComment(cx); cx.stop_propagation(); } })
        .child(Textarea.new(this.note).w_full().px(8).py(6).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(h_flex().gap(6).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child("Ctrl+Enter sends"))
          .child(h_flex().id("send-comment").h(28).px(12).items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer()
            .hover((st) => st.opacity(0.88)).on_click((_e, cx) => sendComment(cx)).child("Send")))))
      .when(this.actError?.url === url, (e) => e.child(div().text_size(11.5).text_color(t.ansi1).child(this.actError.text)))
      .when(this.actOk?.url === url, (e) => e.child(div().text_size(11.5).text_color(t.ansi2).child(`✓ ${this.actOk.text}`)));
  }

  scheduleBlock(card, t) {
    const x = this.scheduleFor(card.url), on = active(x);
    const box = v_flex().w_full().p(10).gap(7).rounded(8).bg(t.raised).border_1().border_color(on ? t.accent : t.border);
    if (on) {
      return box
        .child(h_flex().w_full().gap(6).items_center()
          .child(icon("pending", 11, t.accent))
          .child(div().flex_1().min_w(0).truncate().font_medium().child(`Merge ${when(x.at)}`))
          .child(div().id("sched-cancel").h(24).px(8).flex().items_center().rounded(6).text_size(11.5).text_color(t.ansi1).cursor_pointer().hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => this.cancelSchedule(x, cx)).child("Cancel")))
        .child(div().text_size(11.5).text_color(t.dim).child(`${x.method} · ${x.head ? "only this commit" : "follows new commits"} · by ${sanitize(x.by)} · on ${keyName(x.machine ?? "")}`))
        .when(Boolean(x.message), (e) => e.child(div().text_size(11.5).text_color(x.state === "waiting" ? t.working : t.muted).child(sanitize(x.message))));
    }
    const cfg = schedConfig(), target = this.schedTarget();
    if (target === null) {
      return box
        .child(div().font_medium().child("Schedule a merge"))
        .child(div().text_size(11.5).text_color(t.muted).child("No machine runs scheduled merges yet."))
        .child(h_flex().id("sched-setup").h(28).px(12).flex_none().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer()
          .hover((st) => st.opacity(0.88)).on_click((_e, cx) => this.openSettings(cx)).child("Set up a scheduler"));
    }
    const where = cfg.machines.length > 1
      ? h_flex().gap(4).flex_wrap().items_center().child(div().text_size(11).text_color(t.dim).child("runs on"))
        .children(cfg.machines.map((k) => h_flex().id(`sched-on-${k || "local"}`).h(22).px(7).items_center().rounded(5).text_size(11).cursor_pointer()
          .border_1().border_color(k === target ? t.accent : t.border).text_color(k === target ? t.foreground : t.muted).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.schedOn = k; cx.notify(); }).child(keyName(k))))
      : div().text_size(11).text_color(t.dim).child(`runs on ${keyName(target)}`);
    return box
      .child(h_flex().w_full().gap(6).items_center().child(div().flex_1().font_medium().child("Schedule a merge")).child(where))
      .child(h_flex().w_full().gap(6).items_center()
        .child(Input.new(this.whenInput).flex_1().min_w(0).h(28).px(8).rounded(6).border_1().border_color(this.typing ? t.accent : t.input).bg(t.background).text_size(12).text_color(t.foreground))
        .child(h_flex().id("sched-go").h(28).px(12).flex_none().items_center().rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer()
          .hover((st) => st.opacity(0.88)).on_click((_e, cx) => this.submitSchedule(card, cx)).child(this.scheduling ? "Scheduling…" : "Schedule")))
      .child(h_flex().id("sched-lock").gap(7).items_center().cursor_pointer().on_click((_e, cx) => { this.lockHead = !this.lockHead; cx.notify(); })
        .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(4).border_1().border_color(this.lockHead ? t.accent : t.input).when(this.lockHead, (e) => e.bg(t.accent).child(icon("check", 10, t.background))))
        .child(div().text_size(11.5).text_color(t.muted).child("Only this commit: give up if new commits are pushed")))
      .child(div().text_size(11).text_color(t.dim).child(`Merges as ${this.method}, only if checks passed and there's no conflict; waits up to 1 h for running checks.`))
      .when(Boolean(this.formError), (e) => e.child(div().text_size(11.5).text_color(t.ansi1).child(this.formError)))
      .when(Boolean(x), (e) => e.child(div().text_size(11.5).text_color(x.state === "merged" ? t.ansi2 : x.state === "failed" ? t.ansi1 : t.dim)
        .child(`Last schedule: ${x.state}${x.message ? ` · ${sanitize(x.message)}` : ""}`)));
  }

  // Scheduled merges, at the top of the list: upcoming ones, and what happened in the last day.
  scheduledRows(t) {
    const now = Date.now() / 1000;
    const items = this.schedules.filter((x) => active(x) || (x.state !== "cancelled" && now - x.updated < 86_400)).sort((a, b) => a.at - b.at);
    if (!items.length) return null;
    return v_flex().w_full().flex_none().gap(2).pb(6)
      .child(div().px(4).pt(2).pb(3).text_size(11.5).font_medium().text_color(t.dim).child("Scheduled merges"))
      .children(items.map((x) => {
        const on = active(x), color = on ? (x.state === "waiting" ? t.working : t.accent) : x.state === "merged" ? t.ansi2 : t.ansi1;
        return h_flex().id(`sched-${x.id}`).w_full().flex_none().px(10).py(7).gap(8).items_center().rounded(8).bg(t.raised).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => {
            this.tracker.track(x.url);
            this.openPr(x.url, cx);
            cx.spawn(async (cx) => { await this.tracker.refresh(x.url); cx.notify(); });
          })
          .child(div().w(3).h(28).flex_none().rounded(2).bg(color))
          .child(v_flex().flex_1().min_w(0)
            .child(div().w_full().truncate().font_medium().child(sanitize(x.title)))
            .child(div().w_full().truncate().text_size(11.5).text_color(t.dim).child(`${x.repo.split("/")[1]} #${x.number} · ${x.method} · ${sanitize(x.by)}`)))
          .child(v_flex().flex_none().items_end()
            .child(div().text_size(12).text_color(color).child(on ? when(x.at) : x.state))
            .when(Boolean(x.message) && !on, (e) => e.child(div().max_w(120).truncate().text_size(11).text_color(t.dim).child(sanitize(x.message))))
            .when(x.state === "waiting", (e) => e.child(div().text_size(11).text_color(t.dim).child("waiting for checks"))));
      }));
  }

  command(name, cx) {
    if (name === "requests") { this.selectInbox("requests", cx); return; }
    const cards = this.shown(), card = this.url ? this.current() : cards[this.selected];
    // pr-hub.org:<owner> shows one owner's PRs; pr-hub.org alone shows all.
    // pr-hub.repo:<owner/name> shows one repo (and chooses its owner).
    if (String(name).startsWith("org")) this.setOrg(String(name).split(":")[1] || null);
    else if (String(name).startsWith("repo")) { const repo = String(name).split(":")[1] || null; if (repo) this.setOrg(repo.split("/")[0]); this.setRepo(repo); }
    else if (name === "next") this.select(Math.min(this.selected + 1, cards.length - 1));
    else if (name === "prev") this.select(this.selected - 1);
    else if (name === "open" && card) this.openPr(card.url, cx);
    else if (name === "back") this.back(cx);
    else if (name === "agent") this.goToAgent(card);
    else if (name === "github" && card) openExternal(card.url);
    else if (name === "refresh") this.refreshNow(cx);
    else if (name === "settings") { if (this.settingsOpen) this.settingsOpen = false; else this.openSettings(cx); }
    else if (name.startsWith("lang-")) setShared(LANG_KEY, name.slice(5));
    else if (name === "first-run" && card?.flow) { const r = flowRows(card, this.t, Date.now())[0]; if (r) this.toggleRun(card, r.id, cx); }
    else if (name === "last-run" && card?.flow) { const r = flowRows(card, this.t, Date.now()).at(-1); if (r) this.toggleRun(card, r.id, cx); }
    else if (name === "run-log" && card?.flow) { const r = flowRows(card, this.t, Date.now()).find((x) => x.failed); if (r) this.openViewer({ kind: "log", repo: card.repo, runId: String(r.id), name: r.label, url: r.url, title: card.pr.title, number: card.number }); }
    else if (name === "first-issue" && card?.issues?.[0]) this.openIssue(card.issues[0].url, cx);
    else if (name === "issue-back") this.issueUrl = null;
    else if (name === "checks") this.toggle("checks");
    else if (name === "first-file" && card?.pr?.files?.[0]) this.showFile(card, card.pr.files[0].path);
    else if (name === "log" && card) { const l = this.logFor(card); if (l?.tail) this.showLog(card, l); }
  }

  toggle(key) {
    if (this.opened.has(key)) this.opened.delete(key); else this.opened.add(key);
  }

  // Long lists start folded, so they don't push the description out of reach.
  filesOpen(card, count) {
    return this.filesFold.get(card.url) ?? count <= FILES_FOLD_AT;
  }

  toggleRun(card, runId, cx) {
    this.toggle(`run-${runId}`);
    if (!this.opened.has(`run-${runId}`)) return;
    cx.spawn(async (cx) => { await this.tracker.loadJobs(card.url, runId); cx.notify(); });
  }

  openIssue(url, cx) {
    this.issueUrl = url;
    this.handle.focus();
    cx.spawn(async (cx) => {
      try { this.issueData.set(url, await this.gh.fetchIssue(url)); }
      catch { if (!this.issueData.has(url)) this.issueData.set(url, { failed: true }); }
      cx.notify();
    });
  }

  showFile(card, path) {
    const { pr } = card;
    this.openViewer({ kind: "diff", url: card.url, path, title: pr.title, number: card.number, additions: pr.additions, deletions: pr.deletions });
  }

  showLog(card, log) {
    this.openViewer({ kind: "log", repo: log.repo, runId: log.runId, name: log.name, url: log.url, title: card.pr.title, number: card.number });
  }

  // Saved in shared state, so the viewer pane follows the panel. A layout's `lang` prop is the default.
  langChoice() {
    return shared(LANG_KEY) ?? props()?.lang ?? "auto";
  }

  useLang() {
    const lang = effectiveLang(this.langChoice(), this.system);
    if (lang !== this.lang) { this.lang = lang; this.t = translator(lang); }
  }

  signature() {
    return JSON.stringify(this.tracker.cards().map((c) => [c.url, c.pr?.updatedAt, c.pr?.state, c.status?.name, c.status?.review, c.status?.comments, c.status?.ci?.kind, c.status?.ci?.checks?.map((x) => x.state), c.agent?.address, c.agent?.status, c.issues?.map((i) => i.state), c.flow?.active, c.flow?.runs?.map((r) => [r.id, r.status, r.conclusion]), Object.values(c.flow?.jobs ?? {}).map((j) => j.jobs.map((x) => x.steps.map((y) => y.status)))])) + this.tracker.lastError();
  }

  tick(cx) {
    if (this.busy || this.ghOn === null) return;
    this.busy = true;
    const before = this.signature();
    cx.spawn(async (cx) => {
      try { await this.tracker.tick(agentList()); } catch {} finally { this.busy = false; }
      if (this.signature() !== before) { this.syncLog(cx); cx.notify(); }
    });
  }

  refreshNow(cx) {
    this.refreshing = true;
    this.ghReady = true;
    cx.notify();
    cx.spawn(async (cx) => {
      this.ghReady = await this.findGh();
      this.tracker.forceMine();
      await this.tracker.refreshAll();
      this.loadSchedules(cx);
      this.refreshing = false;
      this.syncLog(cx);
      cx.notify();
    });
  }

  current() {
    return this.url ? this.tracker.cards().find((c) => c.url === this.url) ?? null : null;
  }

  openPr(url, cx) {
    this.url = url;
    this.handle.focus();
    this.syncLog(cx);
    cx.notify();
    if (shared("pr-hub.expand-on-open") === true) this.openSummary(url);
  }

  openSummary(url = this.url) {
    const card = this.tracker.cards().find(card => card.url === url);
    const request = this.asks.find(a => a.url === url && a.state === "pending");
    openOverlay({mod:"pr-summary",kind:"dialog",frame:"none",width:0.78,height:0.80,
      props:{url,repo:card?.repo,number:card?.number,pr:card?.pr,ghOn:this.ghOn,note:request?.note}});
  }

  back(cx) {
    this.url = null;
    this.issueUrl = null;
    this.handle.focus();
    cx.notify();
  }

  // Fetches the failed CI log for the open PR once per run.
  syncLog(cx) {
    const card = this.current();
    const failed = card?.status?.ci?.failed?.[0];
    const runId = runIdFromUrl(failed?.url);
    if (!runId || this.logs.has(runId)) return;
    const entry = { name: failed.name, runId, repo: card.repo, url: failed.url, tail: null, failed: false };
    this.logs.set(runId, entry);
    cx.spawn(async (cx) => {
      try { entry.tail = logTail(sanitize(await this.gh.failedLog(card.repo, runId))); }
      catch { entry.failed = true; }
      cx.notify();
    });
  }

  canMerge(card) {
    const pr = card.pr;
    return Boolean(this.mergeMethod && pr && pr.state === "OPEN" && !pr.isDraft && pr.mergeable === "MERGEABLE" && card.status?.name === "ready");
  }

  pressMerge(card, cx) {
    if (this.merging || !this.canMerge(card)) return;
    if (this.mergeArmed !== card.url) {
      this.mergeArmed = card.url;
      this.mergeError = null;
      cx.timer.after(4000, (cx) => { if (this.mergeArmed === card.url) { this.mergeArmed = null; cx.notify(); } });
      return;
    }
    this.mergeArmed = null;
    this.merging = card.url;
    const sha = card.pr.headRefOid;
    cx.spawn(async (cx) => {
      try {
        await this.gh.merge(card.url, this.mergeMethod, sha);
        await this.tracker.refresh(card.url);
      } catch (error) {
        this.mergeError = { url: card.url, message: sanitize(error.message) };
      }
      this.merging = null;
      cx.notify();
    });
  }

  mergeButton(card, t) {
    const tr = this.t, armed = this.mergeArmed === card.url, busy = this.merging === card.url;
    const label = busy ? tr("merging") : armed ? tr("merge_confirm") : tr("merge_do", this.mergeMethod);
    return v_flex().px(14).pt(12).gap(6)
      .child(h_flex().id("merge").w_full().h(32).gap(6).items_center().justify_center().rounded(8)
        .bg(armed ? t.ansi2 : t.raised).text_color(armed ? t.background : t.foreground)
        .when(!busy, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)))
        .on_click((_e, cx) => { this.pressMerge(card, cx); cx.notify(); })
        .child(busy ? icon("spinner", 12, t.working).spin(900) : icon("merge", 13, armed ? t.background : t.ansi2))
        .child(div().text_size(12.5).font_medium().child(label)))
      .when(this.mergeError?.url === card.url, (e) => e.child(div().text_size(11.5).text_color(t.ansi1).child(this.mergeError.message)));
  }

  logFor(card) {
    const failed = card.status?.ci?.failed?.[0];
    if (!failed) return null;
    const runId = runIdFromUrl(failed.url);
    return runId ? this.logs.get(runId) ?? null : { name: failed.name, url: failed.url, external: true };
  }

  goToAgent(card) {
    if (card?.agent) run("agent.focus", { terminal: card.agent.address });
  }

  // One viewer pane at a time: a second file replaces what it shows.
  openViewer(target) {
    setShared(VIEW_KEY, { ...target, at: Date.now() });
    const all = panes();
    const open = all.find((p) => p.mod === MOD);
    if (open) { run("pane.focus", { pane: open.pane }); return; }
    const f = focused();
    const beside = all.find((p) => p.pane === f?.pane) ?? all.find((p) => p.tab === f?.tab && p.terminal);
    if (beside) run("pane.split", { direction: "right", pane: beside.pane, mod: MOD, props: { screen: "viewer" } });
    else run("tab.new", { name: "PR", mod: MOD, props: { screen: "viewer" } });
  }

  onKey(e, cx) {
    if (this.typing) return; // keys belong to the field being typed in
    const cards = this.shown();
    if (this.settingsOpen) {
      if (e.key !== "escape" && e.key !== "backspace") return;
      this.settingsOpen = false;
    } else if (this.issueUrl) {
      if (e.key === "o") openExternal(this.issueUrl);
      else if (e.key === "escape" || e.key === "backspace") this.issueUrl = null;
      else return;
    } else if (this.url) {
      const card = this.current();
      if (e.key === "escape" || e.key === "backspace") this.back(cx);
      else if (e.key === "enter" || e.key === "g") this.goToAgent(card);
      else if (e.key === "o" && card) openExternal(card.url);
      else return;
    } else if (this.inboxView === "requests") {
      if (e.key === "escape" || e.key === "backspace") this.selectInbox("pulls", cx);
      else if (e.key === "r") this.refreshNow(cx);
      else return;
    } else {
      if (e.key === "j" || e.key === "down") this.select(Math.min(this.selected + 1, cards.length - 1));
      else if (e.key === "k" || e.key === "up") this.select(Math.max(this.selected - 1, 0));
      else if (e.key === "enter" && cards[this.selected]) { this.openPr(cards[this.selected].url, cx); return; }
      else if (e.key === "g") this.goToAgent(cards[this.selected]);
      else if (e.key === "o" && cards[this.selected]) openExternal(cards[this.selected].url);
      else if (e.key === "r") { this.refreshNow(cx); return; }
      else return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  select(index) {
    this.selected = Math.max(0, index);
    this.selectedUrl = this.shown()[this.selected]?.url;
  }

  // The list's cards: one owner's when one is chosen and still has PRs, else all; then one repo's
  // of those the same way.
  shown() {
    const owned = byOrg(this.tracker.cards().filter(isActiveCard), this.org);
    return this.org ? byRepo(owned, this.repo) : owned;
  }

  setOrg(org) {
    if (org !== this.org) this.setRepo(null);
    this.org = org;
    localStorage.setItem("org", org ?? "");
    this.selected = 0;
    this.selectedUrl = null;
  }

  setRepo(repo) {
    this.repo = repo;
    localStorage.setItem("repo", repo ?? "");
    this.selected = 0;
    this.selectedUrl = null;
  }

  chip(id, label, count, active, onPick, t) {
    return bevel(h_flex().id(id).h(28).flex_none().px(8).gap(6).items_center(),active)
      .text_color(active ? skin().foreground : skin().muted).hover((s) => s.opacity(.86).text_color(skin().foreground))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); })
      .on_click((_e, cx) => { cx.stop_propagation(); onPick(); cx.notify(); })
      .child(div().text_size(11.5).max_w(140).truncate().child(label))
      .child(div().text_size(9.5).text_color(active ? skin().accent : skin().dim).child(String(count)));
  }

  // One chip per owner under the header, when the list has more than one.
  orgBar(all, t) {
    const orgs = orgsOf(all);
    if (orgs.length < 2) return null;
    const on = orgs.some(([o]) => o === this.org) ? this.org : null;
    return h_flex().id("orgs").w_full().min_w(0).flex_none().px(10).pt(7).pb(4).gap(5).flex_wrap().items_center()
      .child(this.chip("org-all", this.t("org_all"), all.length, on === null, () => this.setOrg(null), t))
      .children(orgs.map(([org, count]) => this.chip(`org-${org}`, org, count, on === org, () => this.setOrg(org), t)));
  }

  // Under a chosen owner, one chip per repo of theirs, when they have more than one.
  repoBar(all, t) {
    if (!this.org) return null;
    const owned = all.filter((c) => String(c.repo).split("/")[0] === this.org);
    const repos = reposOf(owned);
    if (repos.length < 2) return null;
    const on = repos.some(([r]) => r === this.repo) ? this.repo : null;
    // Wrap whole controls instead of overlapping hit lanes in a narrow horizontal scroller.
    return h_flex().id("repos").w_full().min_w(0).flex_none().px(10).pt(4).pb(9).gap(5).flex_wrap().items_center().border_b(1).border_color(skin().border)
      .child(this.chip("repo-all", this.t("repo_all"), owned.length, on === null, () => this.setRepo(null), t))
      .children(repos.map(([repo, count]) => this.chip(`repo-${repo}`, repo.split("/")[1], count, on === repo, () => this.setRepo(repo), t)));
  }

  selectInbox(view, cx) {
    this.inboxView = view === "requests" ? "requests" : "pulls";
    localStorage.setItem("inbox-view", this.inboxView);
    this.url = null;
    this.issueUrl = null;
    this.settingsOpen = false;
    this.handle.focus();
    cx.notify();
  }

  header(count, t) {
    const tr = this.t;
    const toolbar = h_flex().relative().h(46).flex_none().px(10).gap(8).items_center().bg(skin().chrome).border_b(1).border_color(skin().border)
      .child(div().absolute().top(0).left(12).w(34).h(1).bg(skin().accent))
      .child(bevel(h_flex().size(27).flex_none().items_center().justify_center()).child(icon("merge",15,skin().accent)))
      .child(div().font_semibold().child(tr("title")))
      .when(count > 0, (e) => e.child(div().px(5).text_size(10).text_color(skin().dim).child(String(count))))
      .child(div().flex_1())
      .child(bevel(h_flex().id("settings").size(28).items_center().justify_center()).hover((s) => s.opacity(0.85))
        .on_click((_e, cx) => this.openSettings(cx))
        .child(icon("settings", 14, t.muted)))
      .child(bevel(h_flex().id("refresh").size(28).items_center().justify_center()).hover((s) => s.opacity(0.85))
        .on_click((_e, cx) => this.refreshNow(cx))
        .tooltip("Refresh pull requests")
        .child(this.refreshing ? icon("spinner", 13, t.muted).spin(900) : icon("refresh", 14, t.muted)));
    const requests = (this.asks ?? []).filter(a => a.state === "pending").length;
    const tab = (id, label, n) => bevel(h_flex().id(`inbox-${id}`).h(31).px(10).gap(6).items_center().flex_none(),this.inboxView === id)
      .text_size(11).text_color(this.inboxView === id ? skin().accent : t.muted).hover(s => s.opacity(.86))
      .on_click((_e,cx) => this.selectInbox(id,cx)).child(label)
      .when(id === "requests", el => el.child(div().px(4).text_size(10).font_semibold().text_color(n ? skin().warning : t.dim).child(String(n))));
    return v_flex().w_full().flex_none().child(toolbar)
      .child(h_flex().w_full().min_w(0).px(10).pt(6).pb(0).gap(4).flex_wrap().items_center().border_b(1).border_color(skin().border)
        .child(tab("pulls","Pull requests",count)).child(tab("requests","Requests",requests)));
  }

  row(card, index, t) {
    const tr = this.t;
    const cardPath="mods/pr-hub/art/pr-component.png";
    t={...t,...artText(cardPath,t)};
    const selected = index === this.selected;
    const short = card.repo.split("/")[1];
    const summary = card.pr ? facts(card, tr) : [];
    const activity = cardActivity(card,tr);
    const motion = shared("neon.motion") !== false && appWindow()?.active !== false;
    const accent = summary.some((f) => f.tone === "bad") ? t.ansi1 : t.accent;
    const width = Math.max(180, (this.panelWidth ?? 440) / (settings().zoom || 1) - 20);
    const height = width / 3;
    const scale = width / 360;
    const textScale = Math.max(1, Math.min(1.45, scale));
    const titleSize = Math.min(12 * textScale, height * .31 / 2.2);
    const titleLines = Math.max(1,Math.floor((height * .31 + .01)/(titleSize * 1.1)));
    const titleHeight = titleLines * titleSize * 1.1;
    const scheduled = this.scheduleFor(card.url);
    const from = card.pr?.headRefName, into = card.pr?.baseRefName;
    const branchHint = from && into ? `Source: ${from}\nTarget: ${into}` : "Branch information unavailable";
    const hint = [card.pr?.title, card.pr ? issueLabel(card, tr) : null,
      from && into ? `${from} → ${into}` : null,
      active(scheduled) ? `Merge ${when(scheduled.at)}` : null,
      card.pr?.autoMergeRequest ? "Auto-merge on" : null,
      card.review ? "Your review requested" : null,
      flowLine(card,tr)?.label].filter(Boolean).join("\n");
    const meta = h_flex().gap(4 * scale).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(10 * textScale).font_bold().text_color(accent).child(`${short} #${card.number}`));
    if (activity) meta.child(h_flex().max_w(width*.42).min_w(0).gap(4).items_center().text_color(toneColor(t,activity.tone)).tooltip(activity.detail)
      .child(icon(activity.icon,Math.max(10,10*textScale),toneColor(t,activity.tone)).when(activity.moving && motion,el=>el.spin(900)))
      .child(div().min_w(0).truncate().text_size(9*textScale).font_semibold().child(activity.label)));
    else if (card.pr) meta.child(div().text_size(9 * textScale).text_color(t.muted).child(relative(Date.now() - Date.parse(card.pr.updatedAt), tr)));
    const badgeSize = Math.max(9, Math.min(18, height * 0.085));
    const badges = (card.pr ? compactBadges(card,tr) : []).map((f,i) => {
      const mark = icon(f.icon, badgeSize, toneColor(t,f.tone));
      if (f.icon === "spinner" && motion) mark.spin(900);
      return div().id(`pr-status-${index}-${i}`).absolute().left(width*(0.185+i*0.18)).bottom(height*0.075).w(width*0.155).h(height*0.12)
        .flex().items_center().justify_center().tooltip(f.label).child(mark);
    });
    const title = card.pr?.title ?? (card.error ? sanitize(card.error) : tr("loading"));
    return div().id(`pr-${index}`).relative().w_full().h(height).flex_none().cursor_pointer().tooltip(hint)
      .on_click((_e, cx) => { this.selected = index; this.selectedUrl = card.url; this.openPr(card.url, cx); })
      .child(image(art(cardPath)).absolute().top(0).left(0).w(width).h(height))
      .child(svg("mods/pr-hub/art/pr-inlay.svg").text_color(skin().accent).absolute().left(width * 0.045).top(height * 0.275).w(width * 0.90).h(height * 0.50))
      .child(div().absolute().left(width*0.16).right(22 * scale).top(height*0.15).child(meta))
      .child(v_flex().absolute().left(width*.075).right(width*.075).top(height*.30).h(height*.34).justify_center()
        .child(div().w_full().flex_none().max_h(titleHeight).overflow_hidden().whitespace_normal().line_height(1.1).text_size(titleSize).font_medium().text_color(t.foreground).child(title)))
      .when(Boolean(card.pr), el => el.child(h_flex().absolute().left(width*.075).right(width*.11).top(height*0.67).min_w(0).gap(5 * scale).items_center().text_size(9 * textScale).tooltip(`${branchHint}\n${issueLabel(card,tr)}`)
        .child(icon("branch", Math.max(10, 10 * textScale), skin().accent))
        .child(div().flex_1().min_w(0).truncate().text_color(skin().accent).child(from || "Source unavailable"))
        .child(div().flex_none().text_color(t.muted).child("→"))
        .child(div().max_w(width * 0.34).min_w(0).flex_none().truncate().text_color(skin().secondary).child(into || "Target unavailable"))))
      .children(badges)
      .when(active(scheduled) || Boolean(card.pr?.autoMergeRequest) || card.review, el=>el.child(div().absolute().right(12 * scale).top(12 * scale).size(5 * scale).rounded(3).bg(t.blocked)))
      .when(selected, (el) => el.child(div().absolute().left(width*0.35).top(height*0.09).w(width*0.4).h(2).bg(accent)));

  }

  list(t) {
    const tr = this.t, all = this.tracker.cards().filter(isActiveCard), cards = this.shown();
    if (this.inboxView === "requests") {
      const asks = this.askRows(t);
      return v_flex().size_full().min_h(0).child(this.header(all.length,t))
        .child(v_flex().id("pr-requests").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(10)
          .when(Boolean(asks), el => el.child(asks))
          .when(!asks, el => el.child(v_flex().w_full().py(24).px(12).gap(9).items_center()
            .child(icon("check",22,skin().accent))
            .child(div().text_size(14).font_semibold().child("No requests waiting"))
            .child(div().text_center().text_size(11).text_color(t.muted).child("Merge requests from your agents appear here for your decision.")))))
        .when(Boolean(this.schedError), el => el.child(div().flex_none().px(12).py(7).text_size(11).text_color(t.blocked).child(sanitize(this.schedError))));
    }
    const scheduled = this.scheduledRows(t);
    if (!cards.length && !scheduled) {
      const noGh = !this.ghReady;
      return v_flex().size_full().child(this.header(0, t))
        .child(v_flex().flex_1().items_center().justify_center().gap(6).px(24)
          .child(icon("merge", 22, t.dim))
          .child(div().pt(4).font_medium().child(tr(noGh ? "gh_title" : "empty_title")))
          .child(div().text_center().text_size(12).text_color(t.dim).child(tr(noGh ? "gh_body" : "empty_body")))
          .when(Boolean(this.tracker.lastError() || this.schedError), (e) => e.child(div().pt(6).text_center().text_size(11.5).text_color(t.ansi1).child(sanitize(this.tracker.lastError() || this.schedError)))));
    }
    // The selection stays on its PR when a new one pushes the rows down.
    const kept = cards.findIndex((c) => c.url === this.selectedUrl);
    this.selected = kept >= 0 ? kept : Math.max(0, Math.min(this.selected, cards.length - 1));
    this.selectedUrl = cards[this.selected]?.url;
    const error = this.tracker.lastError() || this.schedError;
    const bar = this.orgBar(all, t), repoBar = bar && this.repoBar(all, t);
    return v_flex().size_full().child(this.header(cards.length, t))
      .when(Boolean(bar), (e) => e.child(bar))
      .when(Boolean(repoBar), (e) => e.child(repoBar))
      .child(v_flex().id("pr-list").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(9).when(Boolean(scheduled), (e) => e.child(scheduled)).children(cards.map((c, i) => this.row(c, i, t))))
      .when(Boolean(error), (e) => e.child(div().flex_none().px(14).py(6).border_t(1).border_color(t.border).text_size(11).text_color(t.blocked).tooltip(sanitize(error)).child(sanitize(error))));
  }

  settingsScreen(t) {
    const tr = this.t, choice = this.langChoice();
    const options = [["auto", tr("lang_auto")], ["ko", "한국어"], ["en", "English"]];
    return v_flex().size_full()
      .child(h_flex().h(42).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
        .child(h_flex().id("settings-back").px(6).h(26).gap(2).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.settingsOpen = false; cx.notify(); })
          .child(icon("back", 14, t.muted)).child(div().text_color(t.muted).child(tr("back"))))
        .child(div().flex_1())
        .child(div().pr(6).font_semibold().child(tr("settings"))))
      .child(v_flex().id("pr-settings-body").flex_1().min_h(0).overflow_y_scrollbar()
      .child(this.section("Opening pull requests", t))
      .child(v_flex().px(10).gap(7)
        .child(bevel(h_flex().id("expand-on-open").w_full().min_h(42).px(10).py(7).gap(10).items_center(),shared("pr-hub.expand-on-open") === true)
          .on_click(() => setShared("pr-hub.expand-on-open",shared("pr-hub.expand-on-open") !== true))
          .child(div().flex_1().min_w(0).text_size(12).child("Open PRs in expanded window"))
          .child(div().flex_none().text_size(11).text_color(shared("pr-hub.expand-on-open") === true ? skin().accent : t.dim).child(shared("pr-hub.expand-on-open") === true ? "On" : "Off")))
        .child(div().px(3).text_size(11).text_color(t.dim).child("Off keeps PRs in this pane. Expand is always available when you want a larger view.")))
      .child(this.section("Request alerts",t))
      .child(v_flex().px(10).gap(7)
        .children([["pr-hub.request-notifications","Show request notifications"],["pr-hub.request-sound","Play request sound"]].map(([key,label]) => {
          const on = shared(key) !== false;
          return bevel(h_flex().id(key).w_full().min_h(36).px(10).py(7).gap(10).items_center(),on)
            .on_click(() => setShared(key,shared(key) === false))
            .child(div().flex_1().min_w(0).text_size(12).child(label))
            .child(div().flex_none().text_size(11).text_color(on ? skin().accent : t.dim).child(on ? "On" : "Off"));
        }))
        .child(div().px(3).text_size(11).text_color(t.dim).child("Requests stay in the Requests tab and its count updates even when alerts are off.")))
      .child(this.section(tr("language"), t))
      .child(v_flex().px(8).gap(1).children(options.map(([value, label]) =>
        h_flex().id(`lang-${value}`).w_full().h(32).flex_none().px(6).gap(8).items_center().rounded(6).cursor_pointer().when(choice === value, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click(() => setShared(LANG_KEY, value))
          .child(div().flex_1().child(label))
          .when(choice === value, (e) => e.child(icon("check", 13, t.ansi2))))))
      .child(this.section("Scheduled merges", t))
      .child(this.schedulerSettings(t)));
  }

  openSettings(cx) {
    this.settingsOpen = true;
    this.loadSchedStatus(cx);
    cx.notify();
  }

  // Asks every machine what herdr-pr there says, for the settings rows.
  loadSchedStatus(cx) {
    this.schedInfo = this.schedInfo ?? {};
    for (const key of candidates()) {
      if (this.schedInfo[key]?.busy) continue;
      this.schedInfo[key] = { ...(this.schedInfo[key] ?? {}), checking: true };
      cx.spawn(async (cx) => {
        const info = await schedStatus(key);
        this.schedInfo[key] = { ...info, note: this.schedInfo[key]?.note ?? null, error: this.schedInfo[key]?.error ?? null };
        cx.notify();
      });
    }
  }

  schedAction(key, label, fn, cx) {
    this.schedInfo[key] = { ...(this.schedInfo[key] ?? {}), busy: label, error: null, note: null };
    cx.notify();
    cx.spawn(async (cx) => {
      let note = null, error = null;
      try { note = await fn(); } catch (e) { error = sanitize(String(e?.message ?? e)); }
      const info = await schedStatus(key);
      this.schedInfo[key] = { ...info, note, error };
      this.loadSchedules(cx);
      cx.notify();
    });
  }

  schedulerSettings(t) {
    const cfg = schedConfig(), info = this.schedInfo ?? {};
    const button = (id, label, onClick, { primary = false, danger = false } = {}) =>
      h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).text_size(11.5).cursor_pointer()
        .when(primary, (e) => e.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.88)))
        .when(!primary, (e) => e.border_1().border_color(t.border).text_color(danger ? t.ansi1 : t.muted).hover((s) => s.bg(t.hover)))
        .on_click(onClick).child(label);
    const rows = candidates().map((key) => {
      const s = info[key] ?? { checking: true }, used = cfg.machines.includes(key), isDefault = cfg.default === key;
      const id = key || "local";
      let line, tone = t.dim;
      if (s.busy) line = `${s.busy}…`;
      else if (s.checking && !s.state) line = "checking…";
      else if (s.state === "offline") line = "offline";
      else if (s.state === "missing") line = "herdr-pr not installed";
      else if (s.state === "old") { line = "older herdr-pr: update it"; tone = t.blocked; }
      else if (s.server && s.timer) { line = `scheduler · timer running${s.pending ? ` · ${s.pending} waiting` : ""}${s.gh ? "" : " · gh missing"}`; tone = s.gh ? t.ansi2 : t.blocked; }
      else if (s.server) { line = "scheduler, but its timer is off: set it up again"; tone = t.blocked; }
      else line = "herdr-pr installed, not a scheduler";
      const ready = s.state === "ok" && s.server && s.timer;
      const actions = h_flex().gap(5).flex_none().items_center();
      if (!s.busy && s.state && s.state !== "offline") {
        if (s.state === "missing" || s.state === "old" || !s.server || !s.timer) {
          actions.child(button(`sched-install-${id}`, s.state === "old" ? "Update" : "Set up", (_e, cx) =>
            this.schedAction(key, s.state === "old" ? "Updating" : "Setting up", async () => { const msg = await installScheduler(key); useScheduler(key, true); return msg; }, cx), { primary: true }));
        } else if (!used) {
          actions.child(button(`sched-use-${id}`, "Use", (_e, cx) => { useScheduler(key, true); this.loadSchedules(cx); cx.notify(); }, { primary: true }));
        }
        if (s.state === "ok" && used && ready && !isDefault) actions.child(button(`sched-default-${id}`, "Make default", (_e, cx) => { setDefaultScheduler(key); cx.notify(); }));
        if (used) actions.child(button(`sched-stop-${id}`, "Stop", (_e, cx) => { useScheduler(key, false); this.loadSchedules(cx); cx.notify(); }));
        if (s.server && !used) actions.child(button(`sched-remove-${id}`, "Remove", (_e, cx) => this.schedAction(key, "Removing", () => removeScheduler(key), cx), { danger: true }));
      }
      return v_flex().id(`sched-row-${id}`).w_full().flex_none().px(8).py(7).gap(3).rounded(6).when(used, (e) => e.bg(t.raised))
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().size(7).flex_none().rounded(99).bg(ready && used ? t.ansi2 : used ? t.blocked : t.border))
          .child(v_flex().flex_1().min_w(0)
            .child(h_flex().gap(6).items_center().child(div().truncate().child(keyName(key)))
              .when(isDefault, (e) => e.child(div().px(5).rounded(4).bg(t.accent).text_color(t.accent_foreground).text_size(10.5).child("default"))))
            .child(div().w_full().truncate().text_size(11).text_color(tone).child(line)))
          .child(actions))
        .when(Boolean(s.note), (e) => e.child(div().pl(15).text_size(11).text_color(t.muted).child(sanitize(s.note))))
        .when(Boolean(s.error), (e) => e.child(div().pl(15).text_size(11).text_color(t.ansi1).child(s.error)));
    });
    return v_flex().px(8).pb(14).gap(3)
      .children(rows)
      .child(div().px(8).pt(6).text_size(11).text_color(t.dim).child(
        "Merges run on the machine you pick when scheduling; the default also takes requests agents queue on other machines. "
        + "An always-on server keeps merging while this PC is off. On Windows the timer is Task Scheduler and runs only while you're logged in. "
        + "gh must be signed in on each scheduler."));
  }

  section(title, t) {
    return div().px(14).pt(16).pb(8).text_size(11.5).font_medium().text_color(t.dim).child(title);
  }

  logBlock(card, t) {
    const tr = this.t, log = this.logFor(card);
    if (!log) return null;
    const box = v_flex().id("log").w_full().p(10).rounded(8).bg(t.background).border_1().border_color(t.border).font_family(mono()).text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.border_color(t.input));
    if (log.external || log.failed) {
      return div().px(14).child(box.on_click(() => openExternal(log.url)).child(div().font_family(settings().ui_font_family ?? mono()).child(log.external ? tr("open_github") : tr("log_failed"))));
    }
    if (!log.tail) return div().px(14).child(box.child(div().child(tr("loading"))));
    return div().px(14).child(box
      .on_click(() => this.showLog(card, log))
      .children(log.tail.map((l) => div().w_full().truncate().child(l || " "))));
  }

  detail(card, t) {
    const tr = this.t, now = Date.now();
    const top = h_flex().h(42).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("back").px(6).h(26).gap(2).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.back(cx))
        .child(icon("back", 14, t.muted)).child(div().text_color(t.muted).child(tr("back"))))
      .child(div().flex_1())
      .child(bevel(h_flex().id("pr-expand-summary").h(26).px(8).gap(5).items_center()).text_size(11).text_color(t.accent)
        .tooltip("Read the full PR summary in a larger window")
        .on_click((_e,cx) => {cx.stop_propagation();this.openSummary(card.url);})
        .child(icon("external",12,t.accent)).child("Expand"))
      .child(h_flex().id("gh").px(8).h(26).gap(5).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openExternal(card.url))
        .child(div().text_size(12).text_color(t.muted).child("GitHub")).child(icon("external", 12, t.muted)));
    if (!card.pr) {
      return v_flex().size_full().child(top).child(div().p(14).text_color(card.error ? t.ansi1 : t.dim).child(card.error ? sanitize(card.error) : tr("loading")));
    }
    const { pr, agent } = card;
    const all = [...steps(card, tr, now), ...flowRows(card, tr, now).map((r) => ({ ...r, run: true }))], threads = openThreads(card), files = pr.files ?? [], log = this.logBlock(card, t);
    const filesOpen = this.filesOpen(card, pr.changedFiles ?? files.length);
    const logName = this.logFor(card)?.name;
    return v_flex().size_full().child(top)
      .child(v_flex().id("detail").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(14).pt(14).gap(6)
          .child(div().text_size(15).font_semibold().child(pr.title))
          .child(div().text_size(11.5).text_color(t.dim).child(`${card.repo} #${card.number}`))
          .child(h_flex().min_w(0).gap(7).flex_wrap().items_center().text_size(12).text_color(t.muted)
            .child(icon("branch", 12, t.accent))
            .child(div().min_w(0).whitespace_normal().text_color(skin().accent).child(`From: ${pr.headRefName}`))
            .child(div().text_color(t.dim).child("→"))
            .child(div().min_w(0).whitespace_normal().text_color(skin().secondary).child(`Into: ${pr.baseRefName}`))))
        .when(Boolean(pr.body?.trim()), (e) => e.child(this.section("PR summary", t))
          .child(div().px(14).pb(16).min_w(0).text_size(14).line_height(1.45).child(TextView.markdown(`body-${card.number}`, pr.body))))
        .child(this.section("Actions", t))
        .child(div().px(14).child(this.controls(card, t)))
        .when(pr.state === "OPEN" || Boolean(this.scheduleFor(card.url)), (e) => e.child(this.section("Schedule", t)).child(div().px(14).child(this.scheduleBlock(card, t))))
        .when(Boolean(agent), (e) => e.child(div().px(14).pt(12).child(
          h_flex().id("agent").w_full().px(10).h(38).gap(8).items_center().rounded(8).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.goToAgent(card))
            .child(agentDot(agent.status, t))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(12.5).child(agent.name))
              .child(div().truncate().text_size(11).text_color(t.dim).child(`${agent.app} · ${tr(`a_${agent.status}`)}`)))
            .child(div().flex_none().text_size(11.5).text_color(t.muted).child(tr("agent_go"))).child(icon("arrow", 12, t.muted)))))
        .child(this.section(tr("progress"), t))
        .child(v_flex().px(14).children(all.map((row, i) => this.timelineRow(card, row, i === all.length - 1, t))))
        .when(Boolean(log), (e) => e.child(this.section(tr("failed_log", logName), t)).child(log))
        .when(!(card.issues ?? []).length, (e) => e.child(this.section(tr("issues_none"), t)))
        .when((card.issues ?? []).length > 0, (e) => e.child(this.section(tr("issues", card.issues.length), t)).child(v_flex().px(8).children(card.issues.map((issue, i) => {
          const state = issueState(issue, tr);
          return h_flex().id(`issue-${i}`).w_full().h(30).flex_none().px(6).gap(7).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.openIssue(issue.url, cx))
            .child(div().size(8).flex_none().rounded(99).bg(toneColor(t, state.tone)))
            .child(div().flex_none().text_size(12).text_color(t.dim).child(`#${issue.number}`))
            .child(div().flex_1().min_w(0).truncate().child(issue.title))
            .child(div().flex_none().text_size(11.5).text_color(t.muted).child(state.label));
        }))))
        .when(threads.length > 0, (e) => e.child(this.section(tr("comments_open", threads.length), t)).child(v_flex().px(14).gap(8).children(threads.map((x) =>
          v_flex().w_full().p(10).gap(4).rounded(8).bg(t.raised)
            .child(h_flex().w_full().gap(6).text_size(11).text_color(t.dim).child(div().min_w(0).truncate().child(sanitize(x.where))).child(div().flex_1()).child(div().flex_none().child(sanitize(x.who))))
            .child(div().text_size(12.5).child(sanitize(x.body).slice(0, 400)))))))
        .child(h_flex().id("files-head").px(14).pt(16).pb(8).gap(6).items_center().text_size(11.5).font_medium().text_color(t.dim).cursor_pointer()
          .on_click((_e, cx) => { this.filesFold.set(card.url, !filesOpen); cx.notify(); })
          .child(div().child(tr("files", pr.changedFiles ?? files.length))).child(icon(filesOpen ? "down" : "arrow", 11, t.dim)).child(div().flex_1())
          .child(div().text_color(t.ansi2).child(`+${pr.additions ?? 0}`)).child(div().text_color(t.ansi1).child(`−${pr.deletions ?? 0}`)))
        .when(filesOpen, (e) => e.child(v_flex().px(8).children(files.map((f, i) => {
          const { dir, name } = fileLine(f.path);
          return h_flex().id(`f-${i}`).w_full().h(28).flex_none().px(6).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click(() => this.showFile(card, f.path))
            .child(h_flex().flex_1().min_w(0).child(div().min_w(0).truncate().text_color(t.dim).child(dir)).child(div().flex_none().max_w(220).truncate().child(name)))
            .child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.additions}`)).child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.deletions}`));
        }))))
        .child(div().h(14).flex_none()));
  }

  miniIcon(tone, t) {
    const c = toneColor(t, tone);
    if (tone === "ok") return icon("check", 11, c);
    if (tone === "bad") return icon("cross", 11, c);
    if (tone === "run") return icon("spinner", 10, c).spin(900);
    return icon("pending", 9, tone === "wait" ? t.foreground : t.dim);
  }

  // A workflow's steps, or the PR's checks, under their timeline row.
  subRows(card, row, t) {
    if (row.checks) {
      if (!this.opened.has("checks")) return null;
      const checks = [...card.status.ci.checks, ...card.status.ci.ai];
      return v_flex().w_full().pt(5).gap(3).children(checks.map((c) => h_flex().w_full().gap(6).items_center()
        .child(this.miniIcon(c.state === "passed" ? "ok" : c.state === "failed" ? "bad" : "run", t))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(sanitize(c.name)))));
    }
    if (!row.run || !this.opened.has(`run-${row.id}`)) return null;
    const jobs = jobSteps(card.flow.jobs?.[row.id]?.jobs);
    if (!jobs.length) return div().pt(5).text_size(11.5).text_color(t.dim).child(this.t("loading"));
    return v_flex().w_full().pt(5).gap(3).children(jobs.flatMap((job) => [
      ...(jobs.length > 1 ? [h_flex().w_full().pt(2).gap(6).items_center().child(this.miniIcon(job.tone, t)).child(div().min_w(0).truncate().text_size(11.5).font_medium().child(sanitize(job.name)))] : []),
      ...job.steps.map((x) => h_flex().w_full().gap(6).items_center().when(jobs.length > 1, (e) => e.pl(10))
        .child(this.miniIcon(x.tone, t))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(x.tone === "todo" ? t.dim : t.muted).child(sanitize(x.name)))),
    ]));
  }

  timelineRow(card, row, last, t) {
    const tr = this.t, sub = this.subRows(card, row, t);
    const key = row.run ? `run-${row.id}` : "checks", openable = row.run || row.checks;
    const toggle = (_e, cx) => { if (row.run) this.toggleRun(card, row.id, cx); else this.toggle(key); cx.notify(); };
    const link = (id, label, onClick) => div().id(id).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(onClick).child(label);
    return h_flex().w_full().gap(10).items_start()
      .child(v_flex().w(20).flex_none().items_center().h_full().child(stepMark(row.tone, t)).when(!last, (e) => e.child(div().w(1).flex_1().min_h(14).bg(t.border))))
      .child(v_flex().flex_1().min_w(0).pb(last ? 0 : 12).gap(1)
        .child(h_flex().id(`row-${row.run ? row.id : row.label}`).w_full().gap(4).items_center().when(openable, (e) => e.cursor_pointer().on_click(toggle))
          .child(div().min_w(0).truncate().pt(1).font_medium().text_color(row.tone === "todo" ? t.dim : t.foreground).child(sanitize(row.label)))
          .when(openable, (e) => e.child(icon(this.opened.has(key) ? "down" : "arrow", 11, t.dim))))
        .when(Boolean(row.note), (e) => e.child(div().w_full().truncate().text_size(11.5).text_color(t.dim).child(sanitize(row.note))))
        .when(row.run, (e) => e.child(h_flex().pt(2).gap(10)
          .when(row.failed, (x) => x.child(link(`log-${row.id}`, tr("run_log"), () => this.openViewer({ kind: "log", repo: card.repo, runId: String(row.id), name: row.label, url: row.url, title: card.pr.title, number: card.number }))))
          .when(row.failed, (x) => x.child(link(`rerun-${row.id}`, "Re-run failed jobs", (_e, cx) => this.act(card, `rerun-${row.id}`, `Re-running ${row.label}`, () => this.gh.rerunFailed(card.repo, row.id), cx))))
          .child(link(`web-${row.id}`, "GitHub", () => openExternal(row.url)))))
        .when(Boolean(sub), (e) => e.child(sub)));
  }

  issueScreen(url, t) {
    const tr = this.t, card = this.current(), issue = this.issueData.get(url);
    const top = h_flex().h(42).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
      .child(h_flex().id("issue-back").px(6).h(26).gap(2).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.issueUrl = null; cx.notify(); })
        .child(icon("back", 14, t.muted)).child(div().text_color(t.muted).child(`PR #${card?.number ?? ""}`)))
      .child(div().flex_1())
      .child(h_flex().id("issue-gh").px(8).h(26).gap(5).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openExternal(url))
        .child(div().text_size(12).text_color(t.muted).child("GitHub")).child(icon("external", 12, t.muted)));
    if (!issue || issue.failed) return v_flex().size_full().child(top).child(div().p(14).text_color(issue ? t.ansi1 : t.dim).child(issue ? tr("issue_failed") : tr("loading")));
    const state = issueState(issue, tr), comments = issue.comments ?? [], now = Date.now();
    return v_flex().size_full().child(top)
      .child(v_flex().id("issue").flex_1().min_h(0).overflow_y_scrollbar()
        .child(v_flex().px(14).pt(14).gap(6)
          .child(div().text_size(15).font_semibold().child(sanitize(issue.title)))
          .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
            .child(div().size(8).flex_none().rounded(99).bg(toneColor(t, state.tone)))
            .child(div().text_color(t.muted).child(state.label))
            .child(div().min_w(0).truncate().child(`#${issue.number} · ${sanitize(issue.author?.login ?? "")} · ${relative(now - Date.parse(issue.createdAt), tr)}`)))
          .when((issue.labels ?? []).length > 0, (e) => e.child(h_flex().flex_wrap().gap(4).pt(2).children(issue.labels.map((l) => div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(sanitize(l.name)))))))
        .when(Boolean(issue.body?.trim()), (e) => e.child(div().px(14).pt(14).text_size(12.5).child(TextView.markdown(`issue-${issue.number}`, sanitize(issue.body)))))
        .when(comments.length > 0, (e) => e.child(this.section(tr("issue_comments", comments.length), t)).child(v_flex().px(14).gap(8).children(comments.slice(-20).map((c, i) =>
          v_flex().w_full().p(10).gap(4).rounded(8).bg(t.raised)
            .child(h_flex().w_full().gap(6).text_size(11).text_color(t.dim).child(div().min_w(0).truncate().child(sanitize(c.author?.login ?? ""))).child(div().flex_1()).child(div().flex_none().child(relative(now - Date.parse(c.createdAt), tr))))
            .child(div().text_size(12.5).child(TextView.markdown(`issue-${issue.number}-c${i}`, sanitize(c.body))))))))
        .child(div().h(16).flex_none()));
  }

  // The viewer pane: a PR's diff or a CI log, wide enough to read.
  loadViewer(target, cx) {
    this.loaded = target.at;
    this.target = target;
    this.files = null; this.lines = null; this.viewError = false; this.file = 0;
    this.threads = []; this.cancelComment();
    const on = shared(GH_KEY) || undefined;
    const gh = createGh((cmd, args, o = {}) => exec(cmd, args, { ...o, on }));
    cx.spawn(async (cx) => {
      try {
        if (target.kind === "log") this.lines = sanitize(await gh.failedLog(target.repo, target.runId)).split("\n");
        else {
          this.gh = gh;
          const [diff, head] = await Promise.all([gh.fetchDiff(target.url), gh.fetchHead(target.url)]);
          this.head = head;
          this.files = parseDiff(diff).map((f) => ({ ...f, lines: f.lines.map((l) => ({ ...l, text: sanitize(l.text) })) }));
          this.file = Math.max(0, this.files.findIndex((f) => f.path === target.path));
          await this.loadThreads(target, cx);
        }
      } catch { this.viewError = true; }
      if (this.target === target) cx.notify();
    });
  }

  // Comments are extra: the diff still shows when they can't load.
  async loadThreads(target, cx) {
    try {
      const { threads } = await this.gh.fetchThreads(target.url);
      if (this.target !== target) return;
      this.threads = threads.map((x) => ({ ...x, comments: { nodes: (x.comments?.nodes ?? []).map((c) => ({ author: { login: sanitize(c.author?.login ?? "") }, body: sanitize(c.body) })) } }));
      cx.notify();
    } catch {}
  }

  startComment(row, cx) {
    const at = commentTarget(row);
    if (!at || this.sending) return;
    this.composing = { path: this.files[this.file].path, ...at };
    this.commentError = null;
    this.commentInput.focus();
    cx.notify();
  }

  cancelComment() {
    if (this.sending) return;
    this.composing = null;
    this.commentError = null;
    this.commentInput?.set_value("");
  }

  sendComment(cx) {
    const body = this.commentInput.value().trim(), at = this.composing, target = this.target;
    if (!body || !at || this.sending) return;
    this.sending = true;
    this.commentError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.gh.comment(target.url, { commitId: this.head, body, ...at });
        this.sending = false;
        this.cancelComment();
        await this.loadThreads(target, cx);
      } catch (error) {
        this.sending = false;
        this.commentError = sanitize(error.message);
      }
      cx.notify();
    });
  }

  composer(t) {
    const tr = this.t, at = this.composing;
    const button = (id, label, primary, action) => h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).hover((s) => s.opacity(0.88)).on_click(action).child(label);
    return v_flex().id("composer").w_full().flex_none().p(10).gap(8).border_t(1).border_color(t.border).text_size(12.5)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.cancelComment(); cx.notify(); cx.stop_propagation(); }
        else if (e.key === "enter" && e.modifiers?.platform) { this.sendComment(cx); cx.stop_propagation(); }
      })
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(tr("comment_on", `${at.path}:${at.line}`)))
      .child(Textarea.new(this.commentInput).w_full().px(8).py(6).rounded(6).border_1().border_color(t.accent).bg(t.raised).text_color(t.foreground))
      .when(Boolean(this.commentError), (e) => e.child(div().text_size(11.5).text_color(t.ansi1).child(this.commentError)))
      .child(h_flex().w_full().gap(6).items_center().child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↵"))
        .child(button("comment-cancel", tr("comment_cancel"), false, (_e, cx) => { this.cancelComment(); cx.notify(); }))
        .child(button("comment-send", tr(this.sending ? "comment_sending" : "comment_send"), true, (_e, cx) => this.sendComment(cx))));
  }

  closeViewer() {
    const mine = panes().find((p) => p.mod === MOD);
    if (mine) run("pane.close", { pane: mine.pane });
  }

  viewerRow(l, t) {
    if (l.kind === "comment-head" || l.kind === "comment") {
      return h_flex().w_full().h(20).flex_none().pl(98).items_center().bg(t.raised)
        .text_color(l.kind === "comment" ? t.foreground : t.dim).child(div().whitespace_nowrap().child(l.text || " "));
    }
    if (l.kind === "hunk" || l.kind === "meta") return h_flex().w_full().h(20).flex_none().px(12).items_center().bg(t.raised).text_color(t.dim).child(div().truncate().child(l.text || "⋯"));
    const add = l.kind === "add", del = l.kind === "del";
    const at = commentTarget(l), mine = this.composing;
    const chosen = mine && at && mine.path === this.files[this.file]?.path && mine.line === at.line && mine.side === at.side;
    return h_flex().w_full().h(20).flex_none().items_center().cursor_pointer().when(chosen, (e) => e.bg(t.selected)).when(!chosen && add, (e) => e.bg(t.ansi2 + "18")).when(!chosen && del, (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(38).flex_none().text_right().text_color(t.dim).child(l.oldNo === undefined ? "" : String(l.oldNo)))
      .child(div().w(38).flex_none().text_right().text_color(t.dim).child(l.newNo === undefined ? "" : String(l.newNo)))
      .child(div().w(22).flex_none().text_center().text_color(add ? t.ansi2 : del ? t.ansi1 : t.dim).child(add ? "+" : del ? "-" : ""))
      .child(div().flex_1().whitespace_nowrap().child(l.text));
  }

  viewerBody(t) {
    const tr = this.t, target = this.target;
    if (this.viewError) {
      return v_flex().flex_1().items_center().justify_center().gap(10).px(24)
        .child(div().text_center().text_color(t.muted).child(tr(target.kind === "log" ? "log_failed" : "diff_failed")))
        .child(div().id("gh").px(10).py(5).rounded(6).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openExternal(target.url)).child(tr("open_github")));
    }
    if (target.kind === "log") {
      if (!this.lines) return div().p(14).text_color(t.dim).child(tr("loading"));
      const lines = this.lines;
      return div().flex_1().min_h(0).relative().font_family(mono()).text_size(11.5).child(div().id("log-x").size_full().overflow_x_scrollbar().child(div().min_w(Math.max(600, ...lines.map((l) => l.length * 7 + 40))).h_full().child(
        v_virtual_list("log", lines.length, 20, (i) => String(i), (r) => lines.slice(r.start, r.end).map((l) => div().h(20).flex_none().px(12).whitespace_nowrap().text_color(t.muted).child(l || " "))).size_full())))
        .child(Scrollbar.vertical("log").viewport_from_layout().absolute().inset_0());
    }
    if (!this.files) return div().p(14).text_color(t.dim).child(tr("loading"));
    if (!this.files.length) return div().p(14).text_color(t.dim).child(tr("no_diff"));
    const narrow = (this.size?.width ?? 800) < 620;
    const path = this.files[this.file]?.path;
    const rows = withComments(this.files[this.file]?.lines ?? [], this.threads, path);
    return h_flex().flex_1().min_h(0).items_start()
      .child(v_flex().id("files").w(narrow ? 150 : 220).flex_none().h_full().p(6).gap(1).border_r(1).border_color(t.border).overflow_y_scrollbar().children(this.files.map((f, i) => {
        const { dir, name } = fileLine(f.path);
        return v_flex().id(`vf-${i}`).w_full().flex_none().px(8).py(5).rounded(6).cursor_pointer().when(i === this.file, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.file = i; cx.notify(); })
          .child(div().w_full().truncate().text_size(12.5).child(name))
          .child(h_flex().w_full().gap(6).text_size(11).child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(dir)).child(div().flex_none().text_color(t.ansi2).child(`+${f.added}`)).child(div().flex_none().text_color(t.ansi1).child(`−${f.removed}`)));
      })))
      .child(v_flex().flex_1().min_w(0).h_full().child(div().flex_1().min_h(0).w_full().relative().font_family(mono()).text_size(11.5)
        .child(div().id("diff-x").size_full().overflow_x_scrollbar().child(div().w_full().min_w(Math.max(400, ...rows.map((l) => (l.text?.length ?? 0) * 7 + 130))).h_full().child(
          v_virtual_list(`diff-${this.file}`, rows.length, 20, (i) => String(i), (r) => rows.slice(r.start, r.end).map((l) => this.viewerRow(l, t))).on_item_click((key, cx) => this.startComment(rows[Number(key)], cx)).size_full())))
        .child(Scrollbar.vertical(`diff-${this.file}`).viewport_from_layout().absolute().inset_0()))
        .child(this.composing ? this.composer(t) : div().w_full().flex_none().px(12).py(5).border_t(1).border_color(t.border).text_size(11).text_color(t.dim).child(tr("comment_hint"))));
  }

  renderViewer(t, cx) {
    const want = shared(VIEW_KEY);
    if (want && want.at !== this.loaded) this.loadViewer(want, cx);
    const target = this.target;
    return v_flex().id("viewer").size_full().on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(target), (e) => e
          .child(div().flex_none().font_semibold().child(`#${target.number}`))
          .child(div().min_w(0).truncate().text_color(t.muted).child(target.kind === "log" ? `${target.name} · ${target.title}` : target.title)))
        .child(div().flex_1())
        .when(target?.kind === "diff", (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${target.additions ?? 0}`)).child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${target.deletions ?? 0}`)))
        .child(h_flex().id("close").size(26).flex_none().items_center().justify_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.closeViewer()).child(icon("cross", 13, t.muted))))
      .when(Boolean(target), (e) => e.child(this.viewerBody(t)));
  }

  render(cx) {
    this.useLang();
    const t = skin();
    const shell = v_flex().size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13);
    // A pane already has Herdr's own frame around it.
    if (this.viewer) return v_flex().size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13).child(this.renderViewer(t, cx));
    const card = this.url ? this.current() : null;
    if (this.url && !card) this.url = null; // it closed while open
    const view = shell.id("pr-hub").on_size_change((size,cx)=>{if(Math.abs(size.width-(this.panelWidth??0))>2){this.panelWidth=size.width;cx.notify();}}).track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx)).on_mouse_down("left", () => this.handle.focus())
      .child(this.settingsOpen ? this.settingsScreen(t) : card && this.issueUrl ? this.issueScreen(this.issueUrl, t) : card ? this.detail(card, t) : this.list(t));
    return panelSkin(view);
  }
}
