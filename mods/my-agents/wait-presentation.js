import { WAIT_LABEL } from "./agent-wait.js";

export const STATUS_WORD = { working: "Working", waiting: "Waiting", blocked: "Needs you", done: "Done", idle: "Idle" };
export function waitingText(agent) {
  if (agent?.status !== "waiting") return "";
  return agent.wait?.note?.trim() || `Waiting for ${WAIT_LABEL[agent.wait?.for] || WAIT_LABEL.other}`;
}
export function waitingActivity(agent, activity) {
  const text = waitingText(agent);
  return text ? { ...activity, reported: true, title: text, detail: text } : activity;
}
