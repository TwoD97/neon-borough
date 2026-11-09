// Canonical copy; each mod that shows agent status keeps its own copy (tools/sync-agent-wait.ps1).
// "Waiting": an agent that is blocked on something other than you typing. Three sources, all
// terminal labels written by tools/crew/activity-hook.py or `herdr-crew wait`:
//   herdr.activity.*  a running tool that waits (gh pr checks --watch, a test run, sleep, Monitor),
//                     shown once it has run a little while, so short commands don't flicker;
//   herdr.wait        set when a turn ends saying it waits ("waiting for CI"), by ScheduleWakeup,
//                     or by `herdr-crew wait`; it lasts until the agent works again.
// Needs-you (blocked) always wins; a working agent counts as working unless a tool waits.

export const WAIT_LABEL = {
  ci: "CI checks", pr: "PR review", tests: "tests", deploy: "deploy", agent: "another agent",
  you: "your answer", timer: "a timer", watch: "a watcher", other: "something",
};
// How long a waiting tool must run before the agent shows as waiting.
const GRACE_MS = { you: 0, ci: 4000, timer: 4000, watch: 8000, agent: 8000, deploy: 12000, tests: 20000 };
const STALE_MS = 12 * 3600 * 1000;

function labelsOf(terminal) {
  const labels = terminal?.labels ?? {};
  if (!Array.isArray(labels)) return labels;
  return Object.fromEntries(labels.map((label) => {
    const at = String(label).indexOf("=");
    return at < 0 ? [String(label), ""] : [String(label).slice(0, at), String(label).slice(at + 1)];
  }));
}

function parse(value) {
  try { const data = typeof value === "string" ? JSON.parse(value) : value; return data && typeof data === "object" ? data : null; }
  catch { return null; }
}

// What the agent waits for, or null: { for, note, since, until, source }.
export function waitOf(agent, records = [], now = Date.now()) {
  if (!agent || agent.status === "blocked") return null;
  const terminal = Array.isArray(records) ? records.find((t) => t.address === agent.address) : records;
  const labels = labelsOf(terminal);
  if (agent.status === "working") {
    let best = null;
    for (const [key, value] of Object.entries(labels)) {
      if (!key.startsWith("herdr.activity.")) continue;
      const data = parse(value);
      if (!data?.wait || !Number.isFinite(data.started_ms)) continue;
      const ran = now - data.started_ms;
      if (ran < (GRACE_MS[data.wait] ?? 10000) || ran > STALE_MS) continue;
      if (!best || data.started_ms < best.since) best = { for: data.wait, since: data.started_ms, source: "tool" };
    }
    return best;
  }
  const wait = parse(labels["herdr.wait"]);
  if (!wait?.for) return null;
  const since = Number(wait.since_ms) || now;
  if (now - since > STALE_MS) return null;
  // A timer that should have fired a while ago no longer counts.
  if (Number.isFinite(wait.until_ms) && now > wait.until_ms + 5 * 60000) return null;
  return { for: String(wait.for), note: typeof wait.note === "string" ? wait.note : "", since, until: wait.until_ms, source: wait.source };
}

// The status to show: herdr's own, or "waiting".
export function shownStatus(agent, records, now) {
  return waitOf(agent, records, now) ? "waiting" : agent?.status;
}

// The agent with `status` replaced by the shown one and `wait` attached (for views that read a.status).
export function withWait(agent, records, now) {
  const wait = waitOf(agent, records, now);
  return wait ? { ...agent, status: "waiting", herdrStatus: agent.status, wait } : agent;
}
