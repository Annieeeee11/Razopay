import { hex } from "./ansi.js";

const ink = hex("#E8EEF3");
const shade = hex("#5A6570");
const muted = hex("#8A9AA8");

const WORDMARK = [
  " ████ █████ █████ █████ █     █████  ████ █   █ ████  █████   ",
  "█ ░░░░█░░░░░ ░█░░░ ░█░░░█░    █░░░░░█ ░░░░█░  █░█░░░█ █░░░░░  ",
  " ███░░████░░░ █░░░░ █░░░█░░   ████░░░███░░█░░ █░████░░████░░░ ",
  "  ░░█ █░░░░   █░░   █░░ █░░   █░░░░   ░░█ █░░ █░█░░█░ █░░░░   ",
  "████░░█████░  █░░   █░░ █████ █████░████░░ ███ ░█░░░█░█████░  ",
  " ░░░░ ░░░░░░   ░░    ░░  ░░░░░ ░░░░░ ░░░░ ░ ░░░ ░░░  ░ ░░░░░  ",
  "  ░░░░  ░░░░░   ░     ░   ░░░░░ ░░░░░ ░░░░   ░░░  ░   ░ ░░░░░ ",
];

/** Color █ as brand ink and ░ as drop-shadow. */
function colorLine(line: string): string {
  let out = "";
  for (const ch of line) {
    if (ch === "█") out += ink(ch);
    else if (ch === "░") out += shade(ch);
    else out += ch;
  }
  return out;
}

export function printBanner(): void {
  console.log("\n" + WORDMARK.map(colorLine).join("\n"));
  console.log(muted("  settlement reconciliation") + "\n");
}
