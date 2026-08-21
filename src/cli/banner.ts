import { hex } from "./ansi.js";

/** Pale brand text — matches dashboard `--text` / wordmark. */
const ink = hex("#E8EEF3");
const muted = hex("#8A9AA8");

const WORDMARK = [
  " ████ █████ █████ █████ █     █████  ████ █   █ ████  █████ ",
  "█     █       █     █   █     █     █     █   █ █   █ █     ",
  " ███  ████    █     █   █     ████   ███  █   █ ████  ████  ",
  "    █ █       █     █   █     █         █ █   █ █  █  █     ",
  "████  █████   █     █   █████ █████ ████   ███  █   █ █████ ",
];

export function printBanner(): void {
  console.log("\n" + WORDMARK.map((line) => ink(line)).join("\n"));
  console.log(muted("  settlement reconciliation") + "\n");
}
