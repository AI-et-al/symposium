import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGY_ANSWER_ONLY_ARGS,
  CLAUDE_ANSWER_ONLY_ARGS,
  codexAnswerOnlyArgs,
  runCli,
} from "../src/providers/retained.js";

describe("answer-only argument sets", () => {
  it("claude runs print-mode with user settings only and every tool denied", () => {
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("-p");
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("--strict-mcp-config");
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("--no-session-persistence");
    const settingIdx = CLAUDE_ANSWER_ONLY_ARGS.indexOf("--setting-sources");
    expect(CLAUDE_ANSWER_ONLY_ARGS[settingIdx + 1]).toBe("user");
    const denyIdx = CLAUDE_ANSWER_ONLY_ARGS.indexOf("--disallowedTools");
    expect(CLAUDE_ANSWER_ONLY_ARGS[denyIdx + 1]).toContain("Bash");
    expect(CLAUDE_ANSWER_ONLY_ARGS[denyIdx + 1]).toContain("Write");
  });

  it("codex runs exec in a read-only sandbox, ephemeral, reading stdin", () => {
    const args = codexAnswerOnlyArgs("/tmp/out.txt");
    expect(args[0]).toBe("exec");
    expect(args).toContain("read-only");
    expect(args).toContain("--ephemeral");
    expect(args[args.length - 1]).toBe("-"); // prompt arrives on stdin
    expect(args[args.indexOf("-o") + 1]).toBe("/tmp/out.txt");
  });

  it("agy runs non-interactive piped stdin in sandboxed plan mode without bare -p", () => {
    expect(AGY_ANSWER_ONLY_ARGS[AGY_ANSWER_ONLY_ARGS.indexOf("--output-format") + 1]).toBe("text");
    expect(AGY_ANSWER_ONLY_ARGS[AGY_ANSWER_ONLY_ARGS.indexOf("--mode") + 1]).toBe("plan");
    expect(AGY_ANSWER_ONLY_ARGS).toContain("--sandbox");
    expect(AGY_ANSWER_ONLY_ARGS[AGY_ANSWER_ONLY_ARGS.indexOf("--effort") + 1]).toBe("low");
    // agy 1.5.9 treats -p/--print as a string flag requiring an inline prompt arg,
    // and --disable-slash-commands disables --mode plan.
    expect(AGY_ANSWER_ONLY_ARGS).not.toContain("-p");
    expect(AGY_ANSWER_ONLY_ARGS).not.toContain("--print");
    expect(AGY_ANSWER_ONLY_ARGS).not.toContain("--disable-slash-commands");
  });
});

describe("runCli", () => {
  it("pipes the prompt to stdin and resolves stdout", async () => {
    const out = await runCli("node", ["-e", "process.stdin.pipe(process.stdout)"], "hello council");
    expect(out).toBe("hello council");
  });

  it("honors an explicit ephemeral cwd for workspace isolation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-agy-cwd-"));
    try {
      const out = await runCli("node", ["-e", "process.stdout.write(process.cwd())"], "", 5_000, dir);
      expect(realpathSync(out)).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects with the exit code and stderr on failure", async () => {
    await expect(
      runCli("node", ["-e", "console.error('boom'); process.exit(3)"], ""),
    ).rejects.toThrow(/exited with code 3.*boom/s);
  });

  it("kills a hung child on timeout", async () => {
    await expect(
      runCli("node", ["-e", "setTimeout(() => {}, 60000)"], "", 100),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects when the binary does not exist", async () => {
    await expect(runCli("symposium-no-such-cli-xyz", [], "")).rejects.toThrow();
  });
});
