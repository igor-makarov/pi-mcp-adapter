import { truncateToVisualLines, keyHint } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";

const MCP_PREVIEW_LINES = 5;

type Theme = { fg: (color: string, text: string) => string; bold: (text: string) => string };

export function renderProxyCall(
  args: Record<string, unknown>,
  theme: Theme,
) {
  let text = theme.fg("toolTitle", theme.bold("mcp"));
  if (args.tool) {
    text += " " + theme.fg("accent", String(args.tool));
    if (args.args) {
      try {
        const parsed = JSON.parse(String(args.args));
        const summary = Object.entries(parsed)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(", ");
        text += " " + theme.fg("muted", `{ ${summary} }`);
      } catch {
        text += " " + theme.fg("muted", String(args.args));
      }
    }
    if (args.timeout) {
      text += theme.fg("muted", ` (timeout ${args.timeout}s)`);
    }
    if (args.server) {
      text += theme.fg("muted", ` (${args.server})`);
    }
  } else if (args.connect) {
    text += " " + theme.fg("accent", "connect") + " " + theme.fg("muted", String(args.connect));
  } else if (args.describe) {
    text += " " + theme.fg("accent", "describe") + " " + theme.fg("muted", String(args.describe));
  } else if (args.search) {
    text += " " + theme.fg("accent", "search") + " " + theme.fg("muted", `"${args.search}"`);
  } else if (args.server) {
    text += " " + theme.fg("accent", "list") + " " + theme.fg("muted", String(args.server));
  } else if (args.action) {
    text += " " + theme.fg("accent", String(args.action));
  } else {
    text += " " + theme.fg("accent", "status");
  }
  return new Text(text, 0, 0);
}

export function renderDirectCall(
  originalName: string,
  args: Record<string, unknown>,
  theme: Theme,
) {
  let text = theme.fg("toolTitle", theme.bold(originalName));
  if (args && typeof args === "object") {
    const entries = Object.entries(args);
    if (entries.length > 0) {
      const summary = entries
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(", ");
      text += " " + theme.fg("muted", `{ ${summary} }`);
    }
  }
  return new Text(text, 0, 0);
}

export function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  { expanded }: { expanded: boolean; isPartial: boolean },
  theme: Theme,
) {
  const output = result.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
    .trim() || "";
  if (!output) return undefined;

  const styledOutput = output
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");

  if (expanded) {
    return new Text(`\n${styledOutput}`, 0, 0);
  }

  // Collapsed: width-aware visual truncation (same pattern as bash tool)
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  let cachedSkipped: number | undefined;
  return {
    render: (width: number) => {
      if (cachedLines === undefined || cachedWidth !== width) {
        const res = truncateToVisualLines(styledOutput, MCP_PREVIEW_LINES, width);
        cachedLines = res.visualLines;
        cachedSkipped = res.skippedCount;
        cachedWidth = width;
      }
      if (cachedSkipped && cachedSkipped > 0) {
        const hint = theme.fg("muted", `... (${cachedSkipped} earlier lines,`) +
          ` ${keyHint("expandTools", "to expand")})`;
        return ["", truncateToWidth(hint, width, "..."), ...cachedLines];
      }
      return ["", ...cachedLines];
    },
    invalidate: () => {
      cachedWidth = undefined;
      cachedLines = undefined;
      cachedSkipped = undefined;
    },
  };
}
