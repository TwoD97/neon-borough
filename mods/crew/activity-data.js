// Live activity only: active tool-hook records, then the agent's status message.
// Terminal/conversation titles are deliberately never an activity fallback.
export function reportedActivity(agent, records = [], now = Date.now()) {
  const terminal = records.find(t => t.address === agent.address);
  const labels = terminal?.labels ?? {};
  const entries = Array.isArray(labels) ? labels.map(label => {
    const at = String(label).indexOf("=");
    return at < 0 ? [String(label), ""] : [String(label).slice(0, at), String(label).slice(at + 1)];
  }) : Object.entries(labels);
  const active = agent.status === "working" ? entries.flatMap(([key, value]) => {
    if (!key.startsWith("herdr.activity.")) return [];
    try {
      const data = typeof value === "string" ? JSON.parse(value) : value;
      if (!data || typeof data.tool !== "string" || !Number.isFinite(data.started_ms)) return [];
      if (now - data.started_ms > 3600000 || data.started_ms > now + 60000) return [];
      return [{ tool: data.tool.replace(/[\r\n\t]/g, " ").slice(0, 80), started: data.started_ms }];
    } catch { return []; }
  }).sort((a,b) => b.started - a.started) : [];
  const tools = active.filter(item => item.tool !== "ModelRequest");
  if (tools.length) {
    const lead = tools[0].tool;
    const names = [...new Set(tools.map(t => t.tool))];
    const known = {
      Read: ["Reading files", "scan"], Grep: ["Searching file contents", "scan"],
      Glob: ["Finding files", "scan"], Edit: ["Editing files", "code"],
      Write: ["Writing a file", "code"], Bash: ["Running a command", "work"],
      WebSearch: ["Searching the web", "scan"], WebFetch: ["Reading a web page", "scan"],
      apply_patch: ["Editing files", "code"], exec_command: ["Running a command", "work"],
      view_image: ["Inspecting an image", "scan"], spawn_agent: ["Starting an agent", "work"],
      followup_task: ["Assigning agent work", "work"], wait_agent: ["Waiting for an agent", "work"],
      update_plan: ["Updating the plan", "work"],
    }[lead] ?? [`Using ${lead}`, "work"];
    return {title: names.length > 1 ? `${known[0]} +${names.length - 1}` : known[0], kind: known[1], reported: true, source: "tool", detail: names.join("\n")};
  }
  if (active.some(item => item.tool === "ModelRequest")) {
    return {title:"Generating a response", kind:"work", reported:true, source:"model", detail:"Codex reported an active model request."};
  }
  const report = terminal?.report;
  const sameState = report?.state === agent.status || (agent.status === "idle" && report?.state === "done");
  const message = sameState && typeof report?.msg === "string" ? report.msg.trim() : "";
  if (message) {
    const kind = /\b(test|tests|testing|pytest|vitest|jest)\b/i.test(message) ? "test"
      : /\b(review|reviewing|search|reading|scan|inspect|debug)\b/i.test(message) ? "scan"
      : /\b(edit|editing|writing|code|coding|implement|fix|build|develop|refactor)\b/i.test(message) ? "code" : "work";
    return {title: message, kind, reported: true, source: "report", detail: message};
  }
  return {title: agent.status === "working" ? "Activity not reported" : agent.status === "blocked" ? "Waiting for input" : agent.status === "done" ? "Finished" : "Idle", kind:"work", reported:false, source:"status", detail:"No live activity message is available."};
}
