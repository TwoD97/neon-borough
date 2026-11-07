// Machines as the sidebar shows them: a display name (alias) and an order you choose.
// Shared between my-spaces and my-agents through shared state, so both lists agree:
//   machines.names: { "<key>": "Alias" }   machines.order: ["<key>", ...]
// A key is the machine's name from `hc machine ls`, or "local" for this computer.

import { shared, setShared } from "herdr";

export const LOCAL = "local";
export const keyOf = (machine) => machine ?? LOCAL;
export const machineOf = (key) => (key === LOCAL ? null : key);

export function names() {
  return shared("machines.names") ?? {};
}

// What a machine is called on screen: its alias, else "This computer" or its real name.
export function label(key) {
  return names()[key] || (key === LOCAL ? "This computer" : key);
}

export function rename(key, alias) {
  const next = { ...names() };
  const clean = (alias ?? "").trim();
  if (clean && clean !== (key === LOCAL ? "This computer" : key)) next[key] = clean;
  else delete next[key];
  setShared("machines.names", next);
}

// `keys` in the chosen order: unordered ones follow, this computer first, then by name.
export function ordered(keys) {
  const order = shared("machines.order") ?? [];
  const at = (k) => { const i = order.indexOf(k); return i === -1 ? Infinity : i; };
  return [...new Set(keys)].sort((a, b) => at(a) - at(b) || (a === LOCAL ? -1 : b === LOCAL ? 1 : 0) || a.localeCompare(b));
}

// Puts `key` where `target` is in the order of `keys` (after it when moving down, before when moving up).
export function place(key, target, keys) {
  const list = ordered(keys);
  const from = list.indexOf(key), to = list.indexOf(target);
  if (from === -1 || to === -1 || from === to) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  setShared("machines.order", list);
}

export function move(key, delta, keys) {
  const list = ordered(keys);
  const from = list.indexOf(key), to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  setShared("machines.order", list);
}

// Pages: tabs over the Spaces list, each showing only the machines put on it; the agents
// list follows the same page. "All" (no page) shows every machine.
//   machines.pages: [{ id, name, machines: ["<key>", ...] }]   machines.page: shown page id, or null
//   machines.pageSpace: { "<page id or all>": "<space id>" }, the space last used on each page
export function pages() {
  return shared("machines.pages") ?? [];
}

export function currentPage() {
  const id = shared("machines.page");
  return pages().find((p) => p.id === id) ?? null;
}

export function inPage(key, page = currentPage()) {
  return !page || page.machines.includes(key);
}

export function savePage(page) {
  const list = pages();
  const i = list.findIndex((p) => p.id === page.id);
  if (i === -1) list.push(page); else list[i] = page;
  setShared("machines.pages", [...list]);
}

export function newPageId() {
  return `pg${Date.now().toString(36)}`;
}

export function deletePage(id) {
  setShared("machines.pages", pages().filter((p) => p.id !== id));
  if (shared("machines.page") === id) setShared("machines.page", null);
}

export function movePage(id, delta) {
  const list = pages();
  const from = list.findIndex((p) => p.id === id), to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  setShared("machines.pages", list);
}

export function togglePageMachine(id, key) {
  const page = pages().find((p) => p.id === id);
  if (!page) return;
  const has = page.machines.includes(key);
  savePage({ ...page, machines: has ? page.machines.filter((k) => k !== key) : [...page.machines, key] });
}
