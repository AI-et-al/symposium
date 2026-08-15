import { describe, expect, it } from "vitest";
import {
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
});

describe("runCli", () => {
  it("pipes the prompt to stdin and resolves stdout", async () => {
    const out = await runCli("node", ["-e", "process.stdin.pipe(process.stdout)"], "hello council");
    expect(out).toBe("hello council");
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
