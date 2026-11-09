// Logical pixels. Every row fits beside the native vertical scrollbar.
export function companionGeometry(width, height, count) {
  const w = Math.max(1, Number(width) || 252), h = Math.max(1, Number(height) || 126);
  const compact = w < 160, padding = compact ? 2 : 8, scrollbar = 8;
  const available = Math.max(1, w - padding * 2 - scrollbar);
  const gap = compact ? 4 : 8, header = compact ? 20 : 28;
  const columns = compact ? 1 : Math.max(1, Math.min(count || 1, Math.floor((available + gap) / 74)));
  const rows = Math.ceil(Math.max(0, count) / columns);
  const slot = Math.max(1, Math.min(compact ? 38 : 120, Math.floor((available - gap * (columns - 1)) / columns)));
  const viewport = Math.max(1, h - header);
  const rowHeight = compact ? 48 : Math.min(rows > 1 ? 96 : 104, Math.max(48, viewport));
  const spriteHeight = compact ? Math.min(36, slot * 4 / 3) : Math.min(columns >= 3 || rows > 1 ? 64 : 80, rowHeight - 32, slot * 4 / 3);
  return {width:w,height:h,compact,padding,scrollbar,available,gap,header,columns,rows,slot,viewport,rowHeight,
    spriteHeight,spriteWidth:spriteHeight * .75,contentHeight:rows * rowHeight + Math.max(0,rows - 1) * gap};
}
