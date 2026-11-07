import { skin, art, artText, mix } from "./theme-tokens.js";
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { props, theme, exec, closeOverlay, window, shared } from "herdr";
import { panelSkin } from "./panel-skin.js";
import { bevel } from "./controls.js";

function clean(value) {
  return String(value ?? "").replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g, "")
    .replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
}

export function githubPull(value) {
  const match = /^https?:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?(?:[?#].*)?$/.exec(String(value ?? "").trim());
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  return { repo: `${match[1]}/${match[2]}`, number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}

export default class PullRequestSummary extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.pr = p.pr && typeof p.pr === "object" ? p.pr : null;
    this.reference = githubPull(p.url) || githubPull(p.pr?.url);
    this.repo = clean(p.repo || this.reference?.repo || "");
    this.number = p.number || this.reference?.number || this.pr?.number;
    this.note = clean(p.note).trim();
    this.ghOn = typeof p.ghOn === "string" ? p.ghOn : "";
    this.loading = false;
    this.error = null;
    if (this.pr?.body === undefined) this.load(cx);
  }

  load(cx) {
    if (this.loading) return;
    if (!this.reference) { this.error = "A valid GitHub pull request URL is needed to load the description."; return; }
    this.loading = true;
    this.error = null;
    cx.spawn(async cx => {
      try {
        const result = await exec("gh", ["pr", "view", this.reference.url, "--json", "number,title,body,url,headRefName,baseRefName,state"], this.ghOn ? { on: this.ghOn } : {});
        if (result.code !== 0) throw new Error(String(result.stderr || result.stdout || "GitHub could not load this pull request."));
        const value = JSON.parse(String(result.stdout));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub returned an invalid pull request response.");
        this.pr = { ...(this.pr || {}), ...value };
      } catch (error) { this.error = clean(error?.message || error); }
      this.loading = false;
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  openGitHub() {
    if (!this.reference) return;
    const platform = window()?.platform;
    const command = platform === "windows" ? "explorer.exe" : platform === "macos" ? "open" : "xdg-open";
    exec(command, [this.reference.url]).catch(() => {});
  }

  render(cx) {
    const t = skin(), pr = this.pr || {};
    const title = clean(pr.title || (this.loading ? "Loading pull request…" : "Pull request summary"));
    const body = clean(pr.body);
    const button = (id, label, action, primary = false) => bevel(h_flex().id(id).h(30).px(12).gap(6).items_center().flex_none(), primary,t)
      .text_size(12).text_color(primary ? t.accent : t.muted).hover(s => s.text_color(t.foreground)).on_click(action).child(label);
    const document = v_flex().w_full().max_w(1040).min_w(0).gap(18).px(24).pt(22).pb(32).flex_none()
      .child(div().w_full().min_w(0).whitespace_normal().text_size(23).line_height(1.22).font_semibold().text_color(t.foreground).child(title))
      .child(h_flex().w_full().min_w(0).flex_wrap().gap(10).items_center().text_size(12).text_color(t.muted)
        .child(div().whitespace_normal().text_color(t.accent).child(`${this.repo || "GitHub"}${this.number ? ` #${this.number}` : ""}`))
        .when(Boolean(pr.state), el => el.child(div().text_color(pr.state === "MERGED" ? t.secondary : pr.state === "OPEN" ? t.accent : t.muted).child(clean(pr.state)))))
      .child(h_flex().w_full().min_w(0).gap(12).items_center()
        .child(v_flex().flex_1().min_w(0).gap(6).p(12).bg(t.surface).border_l(2).border_color(t.accent)
          .child(div().text_size(10).font_semibold().text_color(t.accent).child("SOURCE BRANCH"))
          .child(div().w_full().min_w(0).whitespace_normal().text_size(14).line_height(1.4).text_color(t.foreground).child(clean(pr.headRefName || (this.loading ? "Loading…" : "Not available")))))
        .child(div().flex_none().text_size(22).text_color(t.accent).child("→"))
        .child(v_flex().flex_1().min_w(0).gap(6).p(12).bg(t.surface).border_l(2).border_color(t.secondary)
          .child(div().text_size(10).font_semibold().text_color(t.secondary).child("TARGET BRANCH"))
          .child(div().w_full().min_w(0).whitespace_normal().text_size(14).line_height(1.4).text_color(t.foreground).child(clean(pr.baseRefName || (this.loading ? "Loading…" : "Not available"))))))
      .when(Boolean(this.note), el => el.child(v_flex().w_full().min_w(0).gap(7).p(14).border_l(2).border_color(t.warning).bg(t.raised)
        .child(div().text_size(11).font_semibold().text_color(t.warning).child("APPROVAL REQUEST"))
        .child(div().w_full().min_w(0).whitespace_normal().text_size(14).line_height(1.5).text_color(t.foreground).child(this.note))))
      .when(this.loading, el => el.child(h_flex().gap(8).items_center().text_size(13).text_color(t.muted)
        .child(svg("mods/crew/icons/spinner.svg").size(13).text_color(t.accent).when(shared("neon.motion") !== false, e => e.spin(1000)))
        .child("Loading the full description…")))
      .when(Boolean(this.error), el => el.child(v_flex().w_full().min_w(0).gap(10)
        .child(div().whitespace_normal().text_size(13).line_height(1.4).text_color(t.warning).child(this.error))
        .when(Boolean(this.reference), e => e.child(button("summary-retry", "Try again", (_event, context) => { this.load(context); context.notify(); })))))
      .child(div().w_full().min_w(0).text_size(14).line_height(1.5).text_color(t.foreground)
        .when(Boolean(body.trim()), el => el.child(TextView.markdown(`pr-summary-body-${this.number || "pr"}`, body).w_full().min_w(0).text_size(14).line_height(1.5).selectable(true).scrollable(false)))
        .when(!body.trim() && !this.loading && !this.error, el => el.child(div().text_color(t.muted).child("No description was provided for this pull request."))));
    const content = v_flex().id("pr-summary").size_full().min_w(0).min_h(0).bg(t.background).track_focus(this.handle)
      .on_key_down((event, context) => { if (event.key === "escape") { context.stop_propagation(); this.close(); } })
      .child(h_flex().h(48).flex_none().px(18).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/crew/icons/merge.svg").size(18).text_color(t.accent))
        .child(div().flex_1().text_size(14).font_semibold().text_color(t.foreground).child("Pull request summary"))
        .when(Boolean(this.reference), el => el.child(button("summary-github", "Open GitHub", () => this.openGitHub())))
        .child(button("summary-close-top", "Close", () => this.close())))
      .child(v_flex().id("pr-summary-scroll").flex_1().min_h(0).min_w(0).w_full().overflow_y_scrollbar().items_center().child(document))
      .child(h_flex().h(32).flex_none().px(18).gap(8).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child(div().flex_1().child("Pull request description"))
        .child(div().child("Esc to close")));
    return panelSkin(content,t);
  }
}
