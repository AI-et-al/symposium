import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGY_ANSWER_ONLY_ARGS,
  CLAUDE_ANSWER_ONLY_ARGS,
  codexAnswerOnlyArgs,
  retainedEnv,
  runCli,
  SCRUBBED_ENV_VARS,
} from "../src/providers/retained.js";

describe("answer-only argument sets", () => {
  it("claude runs print-mode with user settings only and an empty tool allowlist", () => {
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("-p");
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("--strict-mcp-config");
    expect(CLAUDE_ANSWER_ONLY_ARGS).toContain("--no-session-persistence");
    const settingIdx = CLAUDE_ANSWER_ONLY_ARGS.indexOf("--setting-sources");
    expect(CLAUDE_ANSWER_ONLY_ARGS[settingIdx + 1]).toBe("user");
    // An allowlist of nothing, not a denylist that goes stale as the CLI grows tools.
    const toolsIdx = CLAUDE_ANSWER_ONLY_ARGS.indexOf("--tools");
    expect(CLAUDE_ANSWER_ONLY_ARGS[toolsIdx + 1]).toBe("");
    expect(CLAUDE_ANSWER_ONLY_ARGS).not.toContain("--disallowedTools");
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

  it("kills the child when the council aborts the seat", async () => {
    const controller = new AbortController();
    const run = runCli("node", ["-e", "setTimeout(() => {}, 60000)"], "", 30_000, undefined, controller.signal);
    controller.abort();
    await expect(run).rejects.toThrow(/aborted/);
  });

  it("never hands a metered API key to the subprocess", async () => {
    const saved = { ...process.env };
    try {
      for (const name of SCRUBBED_ENV_VARS) process.env[name] = "secret-" + name;
      process.env.SYMPOSIUM_TEST_PASSTHROUGH = "kept";
      const script = "process.stdout.write(JSON.stringify(Object.keys(process.env)))";
      const seen = JSON.parse(await runCli("node", ["-e", script], "")) as string[];
      expect(seen.filter((name) => SCRUBBED_ENV_VARS.includes(name))).toEqual([]);
      expect(seen).toContain("SYMPOSIUM_TEST_PASSTHROUGH"); // everything else passes through
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("rejects when the binary does not exist", async () => {
    await expect(runCli("symposium-no-such-cli-xyz", [], "")).rejects.toThrow();
  });
});

describe("retainedEnv", () => {
  it("strips every metered credential and keeps the rest", () => {
    const env = retainedEnv({
      PATH: "/usr/bin",
      HOME: "/home/op",
      ANTHROPIC_API_KEY: "a",
      ANTHROPIC_AUTH_TOKEN: "b",
      OPENAI_API_KEY: "c",
      CODEX_API_KEY: "d",
      GEMINI_API_KEY: "e",
      GOOGLE_API_KEY: "f",
      XAI_API_KEY: "g",
      DEEPSEEK_API_KEY: "h",
      OPENROUTER_API_KEY: "i",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/op" });
  });
});
