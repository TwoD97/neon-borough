// A read-only rendering fixture: no network calls and no PR mutation commands.
export const fixture = {
  number: 123,
  title: "A deliberately long pull request title covering responsive summary dialogs, readable descriptions, complete approval context, and code examples across narrow and wide windows",
  state: "OPEN",
  headRefName: "feature/full-readable-summary-with-long-branch-metadata",
  baseRefName: "main",
  body: [
    "# Complete summary",
    "This description must remain readable from its first paragraph to its final checklist. It contains multiple sections, lists, inline `code`, fenced code, a table, and a long explanation that naturally wraps across the available reading width.",
    ...Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\nThis is a full paragraph for section ${i + 1}. The summary keeps its complete source content and uses one flexible vertical scroll area. Longer explanations should wrap naturally and remain selectable.\n\n- Preserve the full description.\n- Keep approval reasons separate.\n- Avoid fixed-height text containers.`),
    "## Code example\n\n```javascript\nconst summary = { readable: true, complete: true };\nconsole.log(summary);\n```",
    "## Validation\n\n| Check | Result |\n| --- | --- |\n| Long title | Wraps |\n| Full body | Preserved |\n| Approval note | Separate |",
    "## Final checklist\n\n- [x] Full markdown content\n- [x] Read-only preview\n- [ ] Review the final paragraph\n\n**END OF FULL SUMMARY — this line must remain reachable.**",
  ].join("\n\n"),
};
