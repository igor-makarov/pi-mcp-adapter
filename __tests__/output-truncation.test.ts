import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateTail,
  truncateToolResult,
} from "../output-truncation.js";

describe("output truncation", () => {
  const testTmpDir = "/tmp/pi/pi-mcp-adapter-tests";
  const previousTmp = process.env.PI_MCP_ADAPTER_TMPDIR;

  beforeEach(() => {
    mkdirSync(testTmpDir, { recursive: true });
    process.env.PI_MCP_ADAPTER_TMPDIR = testTmpDir;
  });

  afterEach(() => {
    process.env.PI_MCP_ADAPTER_TMPDIR = previousTmp;
    rmSync(testTmpDir, { recursive: true, force: true });
  });

  it("matches pi-style tail truncation defaults", () => {
    expect(DEFAULT_MAX_LINES).toBe(2000);
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024);

    const input = ["a", "b", "c", "d"].join("\n");
    const result = truncateTail(input, { maxLines: 2, maxBytes: DEFAULT_MAX_BYTES });

    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.content).toBe("c\nd");
    expect(result.outputLines).toBe(2);
    expect(result.totalLines).toBe(4);
  });

  it("returns result unchanged when output is small", () => {
    const result = truncateToolResult({
      content: [{ type: "text", text: "small output" }],
      details: { keep: true },
    });

    expect(result.content).toEqual([{ type: "text", text: "small output" }]);
    expect(result.details).toEqual({ keep: true });
  });

  it("truncates large text output and saves full output to temp file", () => {
    const lines = Array.from({ length: DEFAULT_MAX_LINES + 50 }, (_, i) => `line-${i + 1}`);
    const fullText = lines.join("\n");

    const result = truncateToolResult({
      content: [
        { type: "text", text: fullText },
        { type: "image", data: "abc", mimeType: "image/png" },
      ],
      details: { server: "demo", nested: true },
    }, { prefix: "pi-mcp-test" });

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("[Showing lines");
    expect(result.content[0].text).toContain("Full output:");
    expect(result.content[1]).toMatchObject({ type: "image", data: "abc", mimeType: "image/png" });

    const details = result.details as { fullOutputPath?: string; truncation?: { truncated?: boolean; totalLines?: number; outputLines?: number }; server?: string; nested?: boolean };
    expect(details.server).toBe("demo");
    expect(details.nested).toBe(true);
    expect(details.truncation?.truncated).toBe(true);
    expect(details.truncation?.totalLines).toBe(DEFAULT_MAX_LINES + 50);
    expect(details.truncation?.outputLines).toBe(DEFAULT_MAX_LINES);
    expect(details.fullOutputPath).toBeTruthy();
    expect(details.fullOutputPath?.startsWith(testTmpDir + "/pi-mcp-test-")).toBe(true);
    expect(existsSync(details.fullOutputPath!)).toBe(true);
    expect(readFileSync(details.fullOutputPath!, "utf-8")).toBe(fullText);
  });

  it("handles byte truncation of a single huge line like pi bash", () => {
    const hugeLine = "x".repeat(DEFAULT_MAX_BYTES + 1000);
    const result = truncateToolResult({
      content: [{ type: "text", text: hugeLine }],
    }, { prefix: "pi-mcp-test", maxBytes: 1024 });

    const details = result.details as { truncation?: { truncated?: boolean; truncatedBy?: string | null; lastLinePartial?: boolean } };
    expect(details.truncation?.truncated).toBe(true);
    expect(details.truncation?.truncatedBy).toBe("bytes");
    expect(details.truncation?.lastLinePartial).toBe(true);
    expect(result.content[0].text).toContain("Showing last");
    expect(result.content[0].text).toContain("Full output:");
  });
});
