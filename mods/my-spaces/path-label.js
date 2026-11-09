// Keep the destination visible at narrow widths; full paths remain in tooltips.
export function pathLabel(path, width = 160) {
  const short = String(path || "Workspace").replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, "~")
    .replace(/^\/(?:home|Users)\/[^/]+/, "~").replace(/\\/g, "/");
  const budget = Math.max(10, Math.floor(width / 6.2));
  if (short.length <= budget) return short;
  const prefix = short.startsWith("~/") ? "~/" : short.slice(0, Math.max(3, Math.floor(budget * .3)));
  return `${prefix}…${short.slice(-(budget - prefix.length - 1))}`;
}
