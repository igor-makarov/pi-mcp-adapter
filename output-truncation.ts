import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  truncateTail,
  formatSize,
} from "@mariozechner/pi-coding-agent";

interface TextContentBlock {
  type: "text";
  text?: string;
}

interface ResultLike {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  details?: unknown;
  isError?: boolean;
}

function getWritableTempDir(): string {
  const candidates = [
    process.env.PI_MCP_ADAPTER_TMPDIR,
    "/tmp/pi",
    "/private/tmp/pi",
    tmpdir(),
  ].filter((dir): dir is string => !!dir);

  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // Try next candidate
    }
  }

  return tmpdir();
}

function writeFullOutputToTempFile(content: string, prefix: string): string | undefined {
  try {
    const id = randomBytes(8).toString("hex");
    const path = join(getWritableTempDir(), `${prefix}-${id}.log`);
    writeFileSync(path, content, "utf-8");
    return path;
  } catch {
    return undefined;
  }
}

function buildTruncationNotice(fullOutput: string, truncation: ReturnType<typeof truncateTail>, fullOutputPath?: string): string {
  const startLine = truncation.totalLines - truncation.outputLines + 1;
  const endLine = truncation.totalLines;
  const fullOutputHint = fullOutputPath
    ? `Full output: ${fullOutputPath}`
    : "Full output could not be saved";

  if (truncation.lastLinePartial) {
    const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
    return `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). ${fullOutputHint}]`;
  }

  if (truncation.truncatedBy === "lines") {
    return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. ${fullOutputHint}]`;
  }

  return `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.maxBytes)} limit). ${fullOutputHint}]`;
}

function getDetailsObject(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }
  return details as Record<string, unknown>;
}

export function truncateToolResult<T extends ResultLike>(
  result: T,
  options: { prefix?: string; maxLines?: number; maxBytes?: number } = {},
): T {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return result;
  }

  const textBlocks = result.content.filter(
    (block): block is TextContentBlock => block.type === "text",
  );

  if (textBlocks.length === 0) {
    return result;
  }

  const fullText = textBlocks
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");

  const truncation = truncateTail(fullText, {
    maxLines: options.maxLines,
    maxBytes: options.maxBytes,
  });

  if (!truncation.truncated) {
    return result;
  }

  const fullOutputPath = writeFullOutputToTempFile(fullText, options.prefix ?? "pi-mcp");
  let outputText = truncation.content || "(no output)";
  outputText += buildTruncationNotice(fullText, truncation, fullOutputPath);

  const nonTextBlocks = result.content.filter((block) => block.type !== "text");
  const details = getDetailsObject(result.details);

  return {
    ...result,
    content: [{ type: "text", text: outputText }, ...nonTextBlocks] as T["content"],
    details: {
      ...details,
      truncation,
      fullOutputPath,
    },
  };
}
