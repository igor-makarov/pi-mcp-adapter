import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  lastLinePartial: boolean;
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
}

interface TextContentBlock {
  type: "text";
  text?: string;
}

interface ResultLike {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  details?: unknown;
  isError?: boolean;
}

function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf-8");
  if (buf.length <= maxBytes) {
    return str;
  }

  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
    start++;
  }
  return buf.slice(start).toString("utf-8");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0);
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      if (outputLinesArr.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
        outputLinesArr.unshift(truncatedLine);
        outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8");
        lastLinePartial = true;
      }
      break;
    }
    outputLinesArr.unshift(line);
    outputBytesCount += lineBytes;
  }

  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines";
  }

  const outputContent = outputLinesArr.join("\n");
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");
  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
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

function buildTruncationNotice(fullOutput: string, truncation: TruncationResult, fullOutputPath?: string): string {
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
