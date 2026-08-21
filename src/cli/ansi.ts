/** Minimal ANSI helpers — no chalk. Respects TTY, NO_COLOR, FORCE_COLOR. */

const force = process.env.FORCE_COLOR;
const enabled =
  force === "0"
    ? false
    : force != null && force !== ""
      ? true
      : Boolean(process.stdout.isTTY) && process.env.NO_COLOR == null;

function wrap(open: string, close: string) {
  return (s: string): string => (enabled ? `${open}${s}${close}` : s);
}

export const bold = wrap("\x1b[1m", "\x1b[22m");
export const dim = wrap("\x1b[2m", "\x1b[22m");
export const cyan = wrap("\x1b[36m", "\x1b[39m");
export const green = wrap("\x1b[32m", "\x1b[39m");
export const yellow = wrap("\x1b[33m", "\x1b[39m");
export const red = wrap("\x1b[31m", "\x1b[39m");
export const white = wrap("\x1b[37m", "\x1b[39m");
export const teal = wrap("\x1b[38;5;37m", "\x1b[39m");

/** 256-color foreground; no-op when color disabled. */
export function fg256(n: number): (s: string) => string {
  return (s: string) => (enabled ? `\x1b[38;5;${n}m${s}\x1b[39m` : s);
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const raw = color.startsWith("#") ? color.slice(1) : color;
  if (raw.length !== 6) throw new Error(`hex() expects #RRGGBB, got ${color}`);
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

/** Truecolor foreground from #RRGGBB; no-op when color disabled. */
export function hex(color: string): (s: string) => string {
  const { r, g, b } = parseHex(color);
  return (s: string) =>
    enabled ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : s;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

export function padEndVisible(s: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(s));
  return s + " ".repeat(pad);
}

export function box(title: string, bodyLines: string[], innerWidth = 64): string {
  const titleVis = visibleWidth(title);
  const top = `┌─ ${title} ${"─".repeat(Math.max(1, innerWidth - titleVis - 3))}┐`;
  const bottom = `└${"─".repeat(innerWidth)}┘`;
  const rows = bodyLines.map((line) => {
    const padded = padEndVisible(line, innerWidth - 2);
    return `│ ${padded} │`;
  });
  return [top, ...rows, bottom].join("\n");
}

export function isColorEnabled(): boolean {
  return enabled;
}
