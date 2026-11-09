import {notify} from "./notifications.js";
import { skin, art, artText } from "./theme-tokens.js";
import { panelSkin } from "./panel-skin.js";
import { iconFor } from "./icons.js";
import { bevel } from "./controls.js";
import { requestFrame } from "./request-skin.js";
import { fitting } from "./fittings.js";
import { copy, reveal, inboxOf, machineName, baseName } from "./transfer.js";
import { zipToDownloads, search, saveText, EDIT_LIMIT, secretRequests, fillSecret, declineSecret } from "./fileops.js";
// Files for the focused pane's folder (lazy tree, bounded read-only previews) with file transfer:
// drop files from your desktop to upload them here, download a remote file or folder to this
// computer, or send it to another machine's ~/inbox. Copies run through scp (transfer.js).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, machines, readTextFile, watchFolder, pickFolder, theme, settings, shared, layout, window} from "herdr";

// Is this mod's block on screen right now (not hidden, and the shown child of every stack above it)?
// Unknown layouts count as shown.
function shownInLayout(mod) {
  let found = null;
  const walk = (n, visible) => {
    if (!n || found !== null) return;
    const vis = visible && !n.hidden;
    if (n.content?.mod === mod) { found = vis; return; }
    for (const c of n.children ?? []) walk(c, vis && (n.type !== "stack" || !n.active || n.active === c.id));
  };
  try { walk(layout(), true); } catch { return true; }
  return found ?? true;
}
const inboxInLayout = () => {
  const has = (n) => !!n && (n.content?.mod === "neon-inbox" || (n.floating ?? []).some((f) => f.content?.mod === "neon-inbox") || (n.children ?? []).some(has));
  try { return has(layout()); } catch { return false; }
};

const MOD = "neon-files";


function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const icon = (name, size, color) => svg(`mods/${MOD}/${name}.svg`).size(size).flex_none().text_color(color);

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.jobs = []; this.jobSeq = 0; this.showJobs = false;
    this.sendFor = null; // the row whose "Send to" choices are open
    this.dropDir = null; // the folder under the pointer, where a drop lands
    this.menuFor = null; // the row whose right-click actions are open
    this.query = InputState.new({ placeholder: "Search files…" });
    this.query.on("submit", (_e, cx) => this.runSearch(cx));
    this.query.on("change", (_e, cx) => { if (!this.query.value().trim() && this.results) { this.results = null; cx.notify(); } });
    this.searchMode = "name"; this.results = null; this.searching = false; this.searchError = null;
    this.editing = false; this.original = null; this.dirty = false; this.saving = false; this.saveNote = null;
    this.ownSecrets = []; this.answered = new Set(); this.secretBusy = null; this.secretError = null;
    Object.defineProperty(this, "secrets", {
      get: () => (inboxInLayout() ? (shared("herdr.requests")?.secrets ?? []) : this.ownSecrets).filter(r => !this.answered.has(`${r.machine}:${r.id}`)),
      set: (v) => { this.ownSecrets = v; },
    });
    this.secretSlots = new Map(); // request key -> index into secretPool
    this.secretPool = [0, 1, 2].map(i => {
      const input = InputState.new({ placeholder: "Paste the value" });
      input.set_masked(true);
      input.on("submit", (_e, cx) => { const r = this.secretFor(i); if (r) this.answerSecret(r, true, cx); });
      return input;
    });
    this.handle = cx.focus_handle();
    this.loadSecrets(cx);
    cx.timer.every(15000, cx => this.loadSecrets(cx));
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refreshSoon(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refreshSoon(cx) {
    if (this.refreshPending) return;
    this.refreshPending = true;
    cx.timer.after(1500, cx => { this.refreshPending = false; this.refresh(cx); });
  }

  refresh(cx) {
    // Hidden (another panel shown, or the panel closed): skip, and catch up when shown again.
    if (!shownInLayout("neon-files")) { this.staleWhileHidden = true; return; }
    this.staleWhileHidden = false;
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.sendFor = null; this.dropDir = null; this.menuFor = null; this.results = null; this.searchError = null;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    this.editing = false; this.original = null; this.dirty = false; this.saveNote = null; this.truncated = false;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview. Use Download or Send to copy it."; return; }
        this.original = text; this.truncated = text.length > 400000;
        this.code = this.editorFor(path, this.truncated ? text.slice(0, 400000) + "\n… (file truncated)" : text, true);
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable). Use Download or Send to copy it."; }
      finally { cx.notify(); }
    });
  }

  editorFor(path, value, readonly) {
    const t = skin(), name = path.split("/").pop(), ext = name.startsWith(".env") ? "sh" : path.includes(".") ? path.split(".").pop() : "txt";
    const state = EditorState.new({ language: LANG[ext] ?? ext, readonly, value,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    if (!readonly) state.on("change", (_e, cx) => { const d = state.value() !== this.original; if (d !== this.dirty) { this.dirty = d; cx.notify(); } });
    return state;
  }

  canEdit() {
    return this.original !== null && !this.truncated && this.original.length <= EDIT_LIMIT;
  }

  startEdit(cx) {
    if (!this.canEdit()) return;
    this.code?.release();
    this.code = this.editorFor(this.file, this.original, false);
    this.editing = true; this.dirty = false; this.saveNote = null;
    cx.notify();
  }

  stopEdit(cx) {
    this.code?.release();
    this.code = this.editorFor(this.file, this.original ?? "", true);
    this.editing = false; this.dirty = false; this.saveNote = null;
    cx.notify();
  }

  save(cx) {
    if (!this.editing || !this.dirty || this.saving || !this.code) return;
    const text = this.code.value(), path = this.file, place = { machine: this.on ?? null, path: `${this.root}/${path}` };
    this.saving = true; this.saveNote = null; cx.notify();
    cx.spawn(async cx => {
      try {
        await saveText(place, text, this.original);
        notify({title:`Saved ${baseName(path)}`,body:machineName(place.machine),level:"success"});
        if (this.file === path) { this.original = text; this.dirty = false; this.saveNote = { ok: true, text: "Saved" }; }
      } catch (e) {
        if (this.file === path) this.saveNote = { ok: false, text: `Not saved: ${e?.message ?? e}` };
        notify({title:`Could not save ${baseName(path)}`,body:"Your edits are still in the editor. Check the error and retry.",level:"error"});
      }
      this.saving = false;
      cx.notify();
    });
  }

  runSearch(cx) {
    const q = this.query.value().trim();
    if (!q || !this.root) { this.results = null; cx.notify(); return; }
    const context = this.context, mode = this.searchMode;
    this.searching = true; this.searchError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        const found = await search(this.root, this.on ?? null, q, mode);
        if (this.context === context) this.results = { query: q, mode, paths: found };
      } catch (e) { if (this.context === context) this.searchError = String(e?.message ?? e); }
      this.searching = false;
      cx.notify();
    });
  }

  zip(path, cx) {
    const place = { machine: this.on ?? null, path: `${this.root}/${path}` };
    const job = { id: ++this.jobSeq, name: `${baseName(path)}.zip`, from: place.machine, into: { machine: null, path: inboxOf(null) }, state: "running", error: null };
    this.jobs = [job, ...this.jobs].slice(0, 30); this.showJobs = true; this.menuFor = null;
    cx.notify();
    cx.spawn(async cx => {
      try { const out = await zipToDownloads(place); job.state = "done"; notify({ title: `Zipped ${baseName(path)}`, body: out, level: "success", timeout: 6000 }); }
      catch (e) { job.state = "failed"; job.error = String(e?.message ?? e); notify({ title: `Couldn't zip ${baseName(path)}`, body: job.error, level: "error", timeout: 12000 }); }
      cx.notify();
    });
  }

  copyPath(path) {
    const full = `${this.root}/${path}`;
    if (window()?.platform === "windows" && !this.on) exec("powershell", ["-NoProfile", "-Command", "& { param($v) Set-Clipboard -Value $v }", full.replace(/\//g, "\\")]).catch(() => {});
    else exec("sh", ["-c", 'printf %s "$1" | (pbcopy 2>/dev/null || xclip -selection clipboard 2>/dev/null || wl-copy 2>/dev/null)', "copy", full]).catch(() => {});
    notify({ title: "Path copied", body: full, level: "info", timeout: 4000 }, {sound:false});
  }

  // --- Secret requests: agents ask for a value they never see (herdr-pr secret) ---------------

  loadSecrets(cx) {
    if (this.secretsBusy || inboxInLayout()) return; // the inbox polls and announces them
    this.secretsBusy = true;
    cx.spawn(async cx => {
      try {
        const where = [null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)];
        const all = [];
        for (const m of where) all.push(...await secretRequests(m).catch(() => []));
        const before = new Set(this.secrets.map(r => `${r.machine}:${r.id}`));
        const fresh = all.filter(r => !before.has(`${r.machine}:${r.id}`));
        if (this.secretsLoaded && fresh.length) notify({ title: "An agent needs a secret", body: fresh.map(r => `${r.key} → ${baseName(r.file)} (${machineName(r.machine)})`).join(" · "), level: "warning", timeout: 20000 });
        this.secretsLoaded = true;
        const sig = JSON.stringify(all);
        if (sig !== this.secretsSig) {
          this.secretsSig = sig; this.secrets = all;
          const live = new Set(all.map(r => `${r.machine}:${r.id}`));
          for (const k of [...this.secretSlots.keys()]) if (!live.has(k)) this.freeSecretSlot(k);
          cx.notify();
        }
      } finally { this.secretsBusy = false; }
    });
  }

  // Lends one of the pooled inputs to a request (null when all three are in use).
  secretInput(r) {
    const k = `${r.machine}:${r.id}`;
    if (!this.secretSlots.has(k)) {
      const used = new Set(this.secretSlots.values());
      const free = this.secretPool.findIndex((_, i) => !used.has(i));
      if (free < 0) return null;
      this.secretSlots.set(k, free);
    }
    return this.secretPool[this.secretSlots.get(k)];
  }

  secretFor(index) {
    for (const [k, i] of this.secretSlots) if (i === index) return this.secrets.find(r => `${r.machine}:${r.id}` === k) ?? null;
    return null;
  }

  freeSecretSlot(k) {
    const i = this.secretSlots.get(k);
    if (i === undefined) return;
    this.secretPool[i].set_value("");
    this.secretSlots.delete(k);
  }

  answerSecret(r, fill, cx) {
    const k = `${r.machine}:${r.id}`, input = this.secretInput(r);
    if (this.secretBusy || !input) return;
    const value = input.value();
    if (fill && !value) return;
    this.secretBusy = k; this.secretError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        if (fill) {
          await fillSecret(r, value);
          notify({ title: `Saved ${r.key}`, body: `${r.file} on ${machineName(r.machine)}`, level: "success", timeout: 6000 });
        } else await declineSecret(r);
        this.freeSecretSlot(k);
        this.answered.add(k);
        this.secrets = this.secrets.filter(x => `${x.machine}:${x.id}` !== k);
      } catch (e) { this.secretError = { key: k, text: String(e?.message ?? e) }; }
      this.secretBusy = null;
      cx.notify();
    });
  }

  secretCards(t) {
    if (!this.secrets.length) return null;
    return v_flex().w_full().min_w(0).flex_none().gap(8).p(8).border_b(1).border_color(skin().border)
      .child(h_flex().gap(7).items_center().child(div().w(3).h(12).bg(skin().warning))
        .child(div().text_size(10).font_semibold().text_color(skin().warning).child(`SECRET REQUESTS · ${this.secrets.length}`)))
      .when(this.secrets.length > this.secretPool.length, el => el.child(div().text_size(11).text_color(t.dim).child(`${this.secrets.length - this.secretPool.length} more waiting: answer these first`)))
      .children(this.secrets.slice(0, this.secretPool.length).map(r => {
        const k = `${r.machine}:${r.id}`, busy = this.secretBusy === k, err = this.secretError?.key === k ? this.secretError.text : null;
        const input = this.secretInput(r);
        return requestFrame(v_flex().id(`secret-${k}`).w_full().min_w(0).flex_none().p(10).gap(7))
          .child(h_flex().w_full().min_w(0).gap(8).items_center()
            .child(div().relative().size(30).flex_none().flex().items_center().justify_center()
              .child(fitting("badge",30,30,{accent:skin().warning}).absolute().top(0).left(0))
              .child(svg("mods/neon-inbox/art/key.svg").size(16).text_color(skin().warning)))
            .child(v_flex().flex_1().min_w(0).gap(2)
              .child(div().text_size(9).font_semibold().text_color(skin().warning).child("SECRET INPUT"))
              .child(div().w_full().truncate().tooltip(r.key).text_size(13).font_semibold().text_color(skin().foreground).child(r.key))))
          .child(div().w_full().truncate().text_size(10.5).text_color(skin().accent).tooltip(r.file).child(`→ ${r.file}`))
          .child(div().text_size(10).text_color(skin().dim).child(`${machineName(r.machine)} · asked by ${r.by}${r.exists ? "" : " · file will be created"}`))
          .when(Boolean(r.note), el => el.child(div().w_full().text_size(12).line_height(1.25).text_color(skin().foreground).child(r.note)))
          .child(bevel(h_flex().id(`secret-in-${k}`).w_full().min_w(0).h(34).px(10).gap(7).items_center()).cursor_text()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .child(svg("mods/neon-inbox/art/key.svg").size(12).flex_none().text_color(skin().accent))
            .when(Boolean(input), el => el.child(Input.new(input).flex_1().min_w(0).h_full().text_size(12).text_color(skin().foreground))))
          .child(h_flex().w_full().gap(6).items_center().flex_wrap()
            .child(div().flex_1().min_w(0).text_size(9).text_color(skin().dim).child("Masked input"))
            .child(bevel(h_flex().id(`secret-save-${k}`).h(28).px(10).flex_none().items_center(),true).text_color(skin().accent).text_size(11)
              .hover(s => s.opacity(0.88)).on_click((_e, cx) => this.answerSecret(r, true, cx)).child(busy ? "Saving…" : "Save"))
            .child(bevel(h_flex().id(`secret-no-${k}`).h(28).px(9).flex_none().items_center()).text_color(t.ansi1).text_size(11)
              .hover(s => s.opacity(.85)).on_click((_e, cx) => this.answerSecret(r, false, cx)).child("Decline")))
          .child(div().text_size(10).line_height(1.25).text_color(skin().dim).child("Written as KEY=value into that file. The agent only learns that it was filled."))
          .when(Boolean(err), el => el.child(div().pl(7).border_l(2).border_color(t.ansi1).text_size(11).text_color(t.ansi1).child(err)));
      }));
  }

  // --- Transfers ---------------------------------------------------------------------------

  // Machines other than `on` that a file can go to: this computer first, then connected ones.
  destinations(on) {
    const all = [null, ...machines().filter(m => m.name && m.layout !== "unavailable").map(m => m.name)];
    return all.filter(m => m !== (on ?? null));
  }

  transfer(from, into, cx) {
    const job = { id: ++this.jobSeq, name: baseName(from.path), from: from.machine ?? null, into, state: "running", error: null, started: Date.now() };
    this.jobs = [job, ...this.jobs].slice(0, 30);
    this.showJobs = true; this.sendFor = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        await copy(from, into);
        job.state = "done";
        notify({ title: `Copied ${job.name}`, body: `${machineName(job.from)} → ${machineName(into.machine)} · ${into.path}`, level: "success", timeout: 6000 });
        if ((into.machine ?? null) === (this.on ?? null)) this.refresh(cx);
      } catch (e) {
        job.state = "failed"; job.error = String(e?.message ?? e);
        notify({ title: `Couldn't copy ${job.name}`, body: job.error, level: "error", timeout: 12000 });
      }
      job.ended = Date.now();
      cx.notify();
    });
  }

  // Files dropped from the desktop (always this computer) land in the hovered folder, else the root.
  upload(paths, cx, folder = null) {
    // A folder row and the panel can both see the same drop: handle it once.
    const sig = JSON.stringify(paths), now = Date.now();
    if (this.lastDrop && this.lastDrop.sig === sig && now - this.lastDrop.at < 800) return;
    this.lastDrop = { sig, at: now };
    this.dropDir = folder;
    if (!this.root || !paths?.length) return;
    const into = { machine: this.on ?? null, path: this.dropDir ? `${this.root}/${this.dropDir}` : this.root };
    for (const p of paths) this.transfer({ machine: null, path: p }, into, cx);
  }

  uploadFolder(cx) {
    const into = { machine: this.on ?? null, path: this.root };
    cx.spawn(async cx => {
      const folder = await pickFolder({ prompt: "Upload" });
      if (folder) this.transfer({ machine: null, path: folder }, into, cx);
    });
  }

  sendTo(path, machine, cx) {
    this.transfer({ machine: this.on ?? null, path: `${this.root}/${path}` }, { machine, path: inboxOf(machine) }, cx);
  }

  // --- View --------------------------------------------------------------------------------


  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const selected = this.file === path;
      out.push(h_flex().id(`file-${path}`).h(30).flex_none().pl(8 + depth * 18).pr(6).gap(7).items_center().rounded(2).border_l(2)
        .border_color(selected ? t.accent : skin().border).cursor_pointer().hover(s => s.bg(t.hover))
        .when(entry.dir, el => el.on_drop((event, cx) => { cx.stop_propagation?.(); this.upload(event.paths, cx, path); }))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menuFor = this.menuFor === path ? null : path; this.sendFor = null; cx.notify(); })
        .child(entry.dir ? icon(`chevron-${open ? "down" : "right"}`, 12, t.dim) : div().w(12).flex_none())
        .child((({ icon: ic, color }) => svg(ic).size(16).flex_none().text_color(color ?? (entry.dir ? t.accent : t.muted)))(iconFor(entry.name, entry.dir)))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
        );
      if (this.menuFor === path) out.push(this.rowMenu(path, entry, depth, t));
      if (this.sendFor === path) out.push(this.sendChoices(path, depth, t));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  // Right-click actions for a row.
  rowMenu(path, entry, depth, t) {
    const remote = Boolean(this.on), full = { machine: this.on ?? null, path: `${this.root}/${path}` };
    const item = (id, label, fn) => h_flex().id(`menu-${id}-${path}`).h(22).px(8).items_center().rounded(2).text_size(11.5)
      .border_1().border_color(skin().accent).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.raised))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); }).child(label);
    return h_flex().id(`menu-${path}`).flex_none().flex_wrap().gap(5).pl(8 + depth * 18 + 19).pr(6).py(5).items_center()
      .when(!entry.dir, el => el.child(item("open", "Open", cx => { this.menuFor = null; this.show(path, cx); cx.notify(); })))
      .when(remote, el => el.child(item("dl", entry.dir ? "Download folder" : "Download", cx => { this.menuFor = null; this.transfer(full, { machine: null, path: inboxOf(null) }, cx); })))
      .child(item("zip", remote ? "Download as .zip" : "Zip to Downloads", cx => this.zip(path, cx)))
      .child(item("send", "Send to…", cx => { this.menuFor = null; this.sendFor = path; cx.notify(); }))
      .child(item("copy", "Copy path", cx => { this.menuFor = null; this.copyPath(path); cx.notify(); }));
  }

  searchResults(t) {
    const r = this.results;
    return v_flex().id("files-results").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
      .child(div().px(4).pb(4).text_size(11).text_color(t.dim).child(`${r.paths.length}${r.paths.length >= 200 ? "+" : ""} ${r.mode === "text" ? "files containing" : "names matching"} “${r.query}”`))
      .children(r.paths.map(p => {
        const name = p.split("/").pop(), dir = p.slice(0, -name.length);
        const row = h_flex().id(`result-${p}`).h(28).flex_none().px(8).gap(6).items_center().rounded(2).border_l(2).border_color(skin().border).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.show(p, cx))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menuFor = this.menuFor === p ? null : p; cx.notify(); })
          .child((({ icon: ic, color }) => svg(ic).size(15).flex_none().text_color(color ?? t.muted))(iconFor(name, false)))
          .child(div().flex_none().max_w(220).truncate().child(name))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir));
        return this.menuFor === p ? v_flex().flex_none().child(row).child(this.rowMenu(p, { dir: false }, 0, t)) : row;
      }))
      .when(this.sendFor && r.paths.includes(this.sendFor), el => el.child(this.sendChoices(this.sendFor, 0, t)))
      .when(!r.paths.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child("Nothing found")));
  }

  sendChoices(path, depth, t) {
    const targets = this.destinations(this.on);
    return h_flex().id(`send-to-${path}`).flex_none().flex_wrap().gap(5).pl(8 + depth * 18 + 19).pr(6).py(5).items_center()
      .child(div().text_size(11).text_color(t.dim).child("Send to"))
      .children(targets.map(m => h_flex().id(`send-${path}-${m ?? "local"}`).h(22).px(8).items_center().rounded(2).text_size(11.5)
        .border_1().border_color(skin().secondary).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.raised))
        .tooltip(`Copies to ${m ? `~/inbox on ${m}` : "your Downloads folder"}`)
        .on_click((_e, cx) => this.sendTo(path, m, cx)).child(machineName(m))))
      .when(!targets.length, el => el.child(div().text_size(11).text_color(t.dim).child("no other machine connected")));
  }

  jobsDrawer(t) {
    const running = this.jobs.filter(j => j.state === "running").length;
    return v_flex().id("files-jobs").flex_none().max_h(220).border_t(1).border_color(skin().border).bg(skin().chrome)
      .child(h_flex().h(30).flex_none().px(10).gap(8).items_center()
        .child(div().w(2).h(14).bg(skin().secondary))
        .child(div().flex_1().text_size(11.5).font_medium().text_color(t.muted).child(running ? `Transfers · ${running} running` : "Transfers"))
        .when(this.jobs.some(j => j.state !== "running"), el => el.child(h_flex().id("jobs-clear").px(6).h(20).items_center().rounded(2).text_size(11).text_color(t.dim).cursor_pointer().hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.jobs = this.jobs.filter(j => j.state === "running"); cx.notify(); }).child("Clear")))
        .child(h_flex().id("jobs-hide").px(6).h(20).items_center().text_size(11).text_color(t.dim).cursor_pointer().hover(s => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.showJobs = false; cx.notify(); }).child("Hide")))
      .child(v_flex().id("jobs-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(4)
        .when(!this.jobs.length, el => el.child(div().px(4).py(6).text_size(11.5).text_color(t.dim).child("Drop files here to upload, or right-click a row to download or send it.")))
        .children(this.jobs.map(j => {
          const color = j.state === "done" ? t.ansi2 : j.state === "failed" ? t.ansi1 : skin().accent;
          const localDest = !j.into.machine;
          return v_flex().id(`job-${j.id}`).flex_none().px(8).py(5).gap(2).rounded(2).bg(t.background).border_l(2).border_color(color)
            .child(h_flex().gap(6).items_center()
              .child(j.state === "running" ? div().text_color(color).text_size(11).frames(["◐", "◓", "◑", "◒"], 160) : div().text_size(11).text_color(color).child(j.state === "done" ? "✓" : "✕"))
              .child(div().flex_1().min_w(0).truncate().text_size(12).child(j.name))
              .when(j.state === "done" && localDest, el => el.child(h_flex().id(`job-open-${j.id}`).px(5).h(18).items_center().text_size(11).text_color(skin().accent).cursor_pointer()
                .on_click(() => reveal(j.into.path)).child("Open"))))
            .child(div().w_full().truncate().text_size(11).text_color(t.dim).child(`${machineName(j.from)} → ${machineName(j.into.machine)} · ${j.into.path}`))
            .when(Boolean(j.error), el => el.child(div().w_full().text_size(11).text_color(t.ansi1).child(j.error)));
        })));
  }

  render(cx) {
    if (key() !== this.context?.key || this.staleWhileHidden) this.refresh(cx);
    const t = skin(), running = this.jobs.filter(j => j.state === "running").length;
    const button = (id, child, tip, onClick, active = false) => bevel(h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().justify_center(), active)
      .hover(s => s.opacity(0.88)).tooltip(tip).on_click((_e, cx) => onClick(cx)).child(child);
    const header = h_flex().relative().h(46).flex_none().px(10).gap(8).items_center().bg(skin().chrome).border_b(1).border_color(skin().border)
      .child(div().absolute().top(0).left(12).w(34).h(1).bg(skin().accent))
      .when(Boolean(this.file), el => el.child(button("files-back", div().text_color(t.muted).child("←"), "Back to the folder", cx => { this.show(null); cx.notify(); })))
      .child(bevel(h_flex().size(27).flex_none().items_center().justify_center()).cursor_default().child(svg("mods/crew/icons/file.svg").size(15).text_color(skin().accent)))
      .child(div().flex_none().text_size(13).font_semibold().text_color(skin().foreground).child("Files"))
      .child(bevel(h_flex().h(21).max_w(112).px(6).gap(5).flex_none().items_center()).cursor_default()
        .tooltip(machineName(this.on))
        .child(svg(`mods/crew/icons/${this.on ? "server" : "monitor"}.svg`).size(10).flex_none().text_color(this.on ? skin().secondary : skin().accent))
        .child(div().min_w(0).truncate().text_size(9.5).text_color(this.on ? skin().secondary : skin().accent).child(machineName(this.on))))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(skin().dim).tooltip(this.file ?? this.root ?? "").child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
      .child(button("files-jobs-toggle", h_flex().gap(4).items_center().child(icon("transfers",13,running ? skin().accent : skin().muted)).when(running > 0,el => el.child(div().text_size(10).text_color(skin().accent).child(String(running)))), "Transfers", cx => { this.showJobs = !this.showJobs; cx.notify(); }, this.showJobs));
    const modeChip = (mode, label) => h_flex().id(`search-${mode}`).h(26).px(7).flex_none().items_center().cursor_pointer()
      .bg(this.searchMode === mode ? skin().selected : skin().chrome).border_b(2).border_color(this.searchMode === mode ? skin().accent : skin().border)
      .text_size(10.5).text_color(this.searchMode === mode ? skin().foreground : skin().muted).hover(s => s.bg(skin().hover).text_color(skin().foreground))
      .on_click((_e, cx) => { this.searchMode = mode; if (this.query.value().trim()) this.runSearch(cx); cx.notify(); }).child(label);
    const searchRow = h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(skin().border)
      .child(bevel(h_flex().id("files-search").flex_1().min_w(0).h(28).px(8).gap(5).items_center(),Boolean(this.results)).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(icon("search",12,skin().accent))
        .child(Input.new(this.query).flex_1().min_w(0).h(24).px(0).rounded(0).border(0).bg("#00000000").text_size(12).text_color(skin().foreground)))
      .child(h_flex().flex_none().gap(3).items_center().child(modeChip("name", "Name")).child(modeChip("text", "Text")))
      .when(Boolean(this.results) || this.searching, el => el.child(bevel(h_flex().id("search-clear").h(24).px(6).items_center()).text_size(11).text_color(t.dim).hover(s => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.results = null; this.query.set_value(""); cx.notify(); }).child(this.searching ? "…" : "✕")));
    const toolbar = h_flex().h(36).flex_none().px(10).gap(8).items_center().bg(skin().chrome).border_b(1).border_color(skin().border)
      .child(button("files-upload", h_flex().gap(5).items_center().child(icon("upload",12,skin().accent)).child(div().text_size(10.5).text_color(skin().muted).child("Upload folder…")), `Copy a folder from this computer into ${this.root ?? "this folder"}`, cx => this.uploadFolder(cx)))
      .child(div().flex_1().min_w(0).truncate().text_size(10).text_color(skin().dim).child("Drop files here · right-click a row for more"));
    const secrets = this.secretCards(t);
    const view = v_flex().id("files").size_full().min_h(0).overflow_hidden().bg("#00000000").text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const mod = e.modifiers?.control || e.modifiers?.platform;
        if (mod && e.key === "s" && this.editing) { this.save(cx); cx.stop_propagation(); }
      })
      .on_drop((event, cx) => this.upload(event.paths, cx))
      .child(header)
      .when(Boolean(secrets), el => el.child(secrets))
      .when(!this.file, el => el.child(searchRow).child(toolbar))
      .when(!this.file && Boolean(this.searchError), el => el.child(div().px(12).py(4).text_size(11).text_color(t.ansi1).child(this.searchError)))
      .when(!this.file && Boolean(this.results), el => el.child(this.searchResults(t)))
      .when(!this.file && !this.results, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))

        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el
        .child(h_flex().h(34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(skin().border)
          .when(Boolean(this.on), el => el.child(button("file-dl", div().text_size(11.5).text_color(t.muted).child("↓ Download"), "Copy to your Downloads folder", cx => this.transfer({ machine: this.on, path: `${this.root}/${this.file}` }, { machine: null, path: inboxOf(null) }, cx))))
          .child(button("file-send", div().text_size(11.5).text_color(t.muted).child("⇄ Send to…"), "Send to another machine", cx => { this.sendFor = this.sendFor === this.file ? null : this.file; cx.notify(); }, this.sendFor === this.file))
          .child(div().flex_1())
          .when(!this.editing && this.canEdit(), el => el.child(button("file-edit", div().text_size(11.5).text_color(skin().accent).child("Edit"), "Edit this file (Ctrl+S saves)", cx => this.startEdit(cx))))
          .when(this.editing, el => el
            .child(button("file-cancel", div().text_size(11.5).text_color(t.muted).child(this.dirty ? "Discard" : "Done"), "Stop editing", cx => this.stopEdit(cx)))
            .child(button("file-save", div().text_size(11.5).text_color(this.dirty ? skin().accent : t.dim).child(this.saving ? "Saving…" : "Save"), "Save (Ctrl+S)", cx => this.save(cx), this.dirty))))
        .when(Boolean(this.saveNote), el => el.child(div().px(12).py(4).text_size(11).text_color(this.saveNote.ok ? t.ansi2 : t.ansi1).child(this.saveNote.text)))
        .when(this.sendFor === this.file, el => el.child(this.sendChoices(this.file, 0, t)))
        .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")))
      .when(this.showJobs, el => el.child(this.jobsDrawer(t)));
    return panelSkin(view);
  }
}
