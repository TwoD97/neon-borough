import { skin, mix } from "./theme-tokens.js";
// File-type icons for the neon panels: iconFor(name, isDir) -> { icon, color }.
// `icon` is an asset path for svg(); `color` is a neon hex, or null for the theme's muted text.
// The SVGs live in mods/neon-files/types/ (generated outlines matching the shipped icons).
const BASE = "mods/neon-files/types";

const C = {
  yellow: "#f2d45c", blue: "#4aa8ff", orange: "#f0a35e", cyan: "#49dcd7", violet: "#b46bdf",
  green: "#7ee787", amber: "#ffcc4d", pink: "#ff6fb0", red: "#ff6b5a", sky: "#2ea8ff",
  rust: "#ff8a5c", teal: "#4dd0e1", lilac: "#c792ea", sand: "#c9a26b", grey: "#8b98a9",
};

// Exact file names first (lower case).
const NAMES = {
  "package.json": ["package", C.orange], "package-lock.json": ["lock", C.grey], "pnpm-lock.yaml": ["lock", C.grey],
  "yarn.lock": ["lock", C.grey], "bun.lockb": ["lock", C.grey], "cargo.lock": ["lock", C.grey], "poetry.lock": ["lock", C.grey],
  "composer.lock": ["lock", C.grey], "gemfile.lock": ["lock", C.grey], "go.sum": ["lock", C.grey], "flake.lock": ["lock", C.grey],
  "cargo.toml": ["package", C.rust], "go.mod": ["package", C.teal], "pyproject.toml": ["package", C.blue],
  "requirements.txt": ["package", C.blue], "gemfile": ["package", C.red], "composer.json": ["package", C.violet],
  "dockerfile": ["docker", C.sky], "docker-compose.yml": ["docker", C.sky], "docker-compose.yaml": ["docker", C.sky],
  "compose.yml": ["docker", C.sky], "compose.yaml": ["docker", C.sky], ".dockerignore": ["docker", C.grey],
  ".gitignore": ["git", C.red], ".gitattributes": ["git", C.red], ".gitmodules": ["git", C.red], ".gitkeep": ["git", C.grey],
  "makefile": ["terminal", C.green], "justfile": ["terminal", C.green], "procfile": ["terminal", C.green],
  "readme": ["info", C.cyan], "readme.md": ["info", C.cyan], "license": ["info", C.amber], "license.md": ["info", C.amber],
  "changelog.md": ["info", C.cyan], "agents.md": ["info", C.violet], "claude.md": ["info", C.orange],
  ".editorconfig": ["config", C.grey], ".prettierrc": ["config", C.pink], ".eslintrc": ["config", C.violet],
  "tsconfig.json": ["config", C.blue], "jsconfig.json": ["config", C.yellow], ".npmrc": ["config", C.red], ".nvmrc": ["config", C.green],
  "vite.config.ts": ["config", C.violet], "vite.config.js": ["config", C.violet], "next.config.js": ["config", C.grey],
};

// Then extensions.
const EXT = {
  js: ["code", C.yellow], mjs: ["code", C.yellow], cjs: ["code", C.yellow], jsx: ["code", C.yellow],
  ts: ["code", C.blue], mts: ["code", C.blue], cts: ["code", C.blue], tsx: ["code", C.blue], "d.ts": ["code", C.sky],
  py: ["code", C.blue], pyi: ["code", C.blue], rs: ["code", C.rust], go: ["code", C.teal], java: ["code", C.red],
  kt: ["code", C.violet], swift: ["code", C.orange], c: ["code", C.sky], h: ["code", C.violet], cpp: ["code", C.sky],
  cc: ["code", C.sky], hpp: ["code", C.violet], cs: ["code", C.green], php: ["code", C.lilac], rb: ["code", C.red],
  lua: ["code", C.blue], dart: ["code", C.teal], zig: ["code", C.amber], vue: ["code", C.green], svelte: ["code", C.rust],
  html: ["code", C.rust], htm: ["code", C.rust], xml: ["code", C.orange],
  css: ["hash", C.violet], scss: ["hash", C.pink], sass: ["hash", C.pink], less: ["hash", C.blue],
  json: ["braces", C.orange], jsonc: ["braces", C.orange], json5: ["braces", C.orange],
  md: ["markdown", C.cyan], mdx: ["markdown", C.cyan], rst: ["text", C.cyan], txt: ["text", null], log: ["text", C.grey],
  yml: ["config", C.lilac], yaml: ["config", C.lilac], toml: ["config", C.rust], ini: ["config", C.grey],
  conf: ["config", C.grey], cfg: ["config", C.grey], properties: ["config", C.grey], plist: ["config", C.grey],
  env: ["key", C.amber], pem: ["key", C.amber], key: ["key", C.amber], crt: ["key", C.amber], pub: ["key", C.amber], p12: ["key", C.amber],
  sh: ["terminal", C.green], bash: ["terminal", C.green], zsh: ["terminal", C.green], fish: ["terminal", C.green],
  ps1: ["terminal", C.sky], psm1: ["terminal", C.sky], bat: ["terminal", C.grey], cmd: ["terminal", C.grey],
  png: ["image", C.pink], jpg: ["image", C.pink], jpeg: ["image", C.pink], gif: ["image", C.pink], webp: ["image", C.pink],
  ico: ["image", C.pink], bmp: ["image", C.pink], avif: ["image", C.pink], svg: ["vector", C.orange],
  zip: ["archive", C.sand], gz: ["archive", C.sand], tgz: ["archive", C.sand], tar: ["archive", C.sand], "7z": ["archive", C.sand],
  rar: ["archive", C.sand], xz: ["archive", C.sand], bz2: ["archive", C.sand], whl: ["archive", C.sand], jar: ["archive", C.sand],
  lock: ["lock", C.grey], sql: ["database", C.lilac], db: ["database", C.lilac], sqlite: ["database", C.lilac], prisma: ["database", C.teal],
  csv: ["sheet", C.green], tsv: ["sheet", C.green], xlsx: ["sheet", C.green], xls: ["sheet", C.green],
  pdf: ["pdf", C.red], ttf: ["font", C.grey], otf: ["font", C.grey], woff: ["font", C.grey], woff2: ["font", C.grey],
  mp4: ["media", C.pink], mov: ["media", C.pink], webm: ["media", C.pink], mp3: ["media", C.violet], wav: ["media", C.violet], ogg: ["media", C.violet],
  exe: ["terminal", C.grey], dll: ["package", C.grey], so: ["package", C.grey], wasm: ["package", C.violet],
};

const FOLDERS = {
  src: ["folder-code", C.cyan], lib: ["folder-code", C.cyan], app: ["folder-code", C.cyan], apps: ["folder-code", C.cyan],
  packages: ["folder-package", C.orange], crates: ["folder-package", C.rust], components: ["folder-code", C.blue],
  ".git": ["folder-git", C.red], node_modules: ["folder-package", C.grey], vendor: ["folder-package", C.grey],
  ".venv": ["folder-package", C.grey], venv: ["folder-package", C.grey], target: ["folder-build", C.grey],
  dist: ["folder-build", C.grey], build: ["folder-build", C.grey], out: ["folder-build", C.grey], ".next": ["folder-build", C.grey],
  ".github": ["folder-github", C.violet], ".gitlab": ["folder-github", C.orange], ".vscode": ["folder-config", C.blue],
  ".idea": ["folder-config", C.grey], ".config": ["folder-config", C.grey], config: ["folder-config", C.lilac], configs: ["folder-config", C.lilac],
  ".claude": ["folder-config", C.orange], ".codex": ["folder-config", C.green], ".herdr": ["folder-config", C.cyan],
  test: ["folder-test", C.green], tests: ["folder-test", C.green], __tests__: ["folder-test", C.green], spec: ["folder-test", C.green], e2e: ["folder-test", C.green],
  docs: ["folder-docs", C.cyan], doc: ["folder-docs", C.cyan],
  assets: ["folder-image", C.pink], images: ["folder-image", C.pink], img: ["folder-image", C.pink], public: ["folder-image", C.pink], static: ["folder-image", C.pink], art: ["folder-image", C.pink],
  scripts: ["folder-terminal", C.green], bin: ["folder-terminal", C.green], tools: ["folder-terminal", C.green],
  mods: ["folder-code", C.violet], layouts: ["folder-config", C.violet], themes: ["folder-image", C.violet],
};

export function iconFor(name, isDir, t=skin()) {
  const ink = color => color && t.light ? mix(color,t.foreground,.58) : color;
  const n = String(name).toLowerCase();
  if (isDir) {
    const [icon, color] = FOLDERS[n] ?? ["folder", null];
    return { icon: `${BASE}/${icon}.svg`, color:ink(color) };
  }
  let hit = NAMES[n];
  if (!hit && (n === ".env" || n.startsWith(".env.") || n.endsWith(".env"))) hit = ["key", C.amber];
  if (!hit && n.startsWith("dockerfile")) hit = ["docker", C.sky];
  if (!hit && /\.(test|spec)\.[a-z]+$/.test(n)) hit = ["test", C.green];
  if (!hit && n.endsWith(".d.ts")) hit = EXT["d.ts"];
  if (!hit) { const dot = n.lastIndexOf("."); if (dot > 0) hit = EXT[n.slice(dot + 1)]; }
  const [icon, color] = hit ?? ["text", null];
  return { icon: `${BASE}/${icon}.svg`, color:ink(color) };
}
