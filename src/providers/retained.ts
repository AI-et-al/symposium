import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ADVISORS } from "../router.js";
import type { ProviderAdapter } from "./types.js";

/**
 * Retained seats are subprocesses of official subscription CLIs (spec principle 4:
 * first-party auth only, no scraping). CLIs pay spawn + auth + queue overhead an API
 * call does not, and the seats run in parallel, so tail latency is nearly free —
 * counsel both live seats gave when asked (2026-08-15 smoke convenings). A timeout
 * is recorded as a failed seat, never retried.
 */
export const RETAINED_TIMEOUT_MS = 180_000;

/**
 * Credentials a retained subprocess must never inherit. The server's own environment
 * holds the metered API keys for the neutral seats, and the CLIs prefer a key over
 * their subscription login when they see one — `claude -p` with ANTHROPIC_API_KEY set
 * bills the Console key per token (verified against claude 2.1.325), which would make
 * a "retained, unmetered" seat a metered one the ledger never priced. Stripping them
 * holds the seat to principle 4 (first-party subscription auth) and keeps the keys
 * out of reach of a CLI that is only supposed to answer.
 */
export const SCRUBBED_ENV_VARS: ReadonlyArray<string> = [
  ...ADVISORS.map((a) => a.envKey),
  "ANTHROPIC_AUTH_TOKEN",
  "CODEX_API_KEY",
  "GOOGLE_API_KEY",
];

/** The environment a retained CLI runs in: the server's, minus every metered credential. */
export function retainedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const name of SCRUBBED_ENV_VARS) delete env[name];
  return env;
}

/**
 * Answer-only mode for `claude -p` (flags verified against claude 2.1.325):
 * user-level settings only (the seat carries its human's context, not whatever
 * project the MCP client launched from), no MCP servers, no session files, and
 * no built-in tools at all. `--tools ""` is an empty allowlist; the denylist it
 * replaced (`--disallowedTools Bash,Edit,…`) went stale whenever the CLI grew a tool,
 * and a user-level `auto` permission mode would have run the unlisted ones unasked.
 */
export const CLAUDE_ANSWER_ONLY_ARGS: ReadonlyArray<string> = [
  "-p",
  "--output-format",
  "text",
  "--setting-sources",
  "user",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--tools",
  "",
];

/**
 * Answer-only mode for `codex exec` (flags verified against codex-cli 0.166.0):
 * read-only sandbox, no session persisted, prompt on stdin (`-`), and the clean
 * final message written to a temp file (`-o`) because stdout carries the transcript.
 */
export function codexAnswerOnlyArgs(lastMessageFile: string): string[] {
  return [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-C",
    homedir(),
    "-o",
    lastMessageFile,
    "-",
  ];
}

/**
 * Answer-only mode for Google Antigravity (`agy`, verified live against agy 1.5.9 on macOS):
 * piped stdin triggers non-interactive print mode automatically (`-p` in agy 1.5.9 takes an
 * inline prompt argument and must not be passed bare when reading stdin), `--mode plan` +
 * `--sandbox` enforce read-only planning with terminal sandboxing, `--output-format text`
 * emits clean stdout, and `--effort low` bounds latency and subscription quota. Note:
 * `--disable-slash-commands` is omitted because agy warns `--mode plan` is inert with it set.
 */
export const AGY_ANSWER_ONLY_ARGS: ReadonlyArray<string> = [
  "--output-format",
  "text",
  "--mode",
  "plan",
  "--sandbox",
  "--effort",
  "low",
];

/**
 * Run one CLI to completion: prompt on stdin, stdout collected, child killed on
 * timeout (or when the council aborts the seat) so no subprocess outlives its
 * convening. Defaults cwd to the home directory (or an explicit ephemeral directory
 * when workspace isolation requires it). The child never sees the metered API keys.
 */
export function runCli(
  command: string,
  args: ReadonlyArray<string>,
  prompt: string,
  timeoutMs: number = RETAINED_TIMEOUT_MS,
  cwd: string = homedir(),
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: retainedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new Error(`${command} aborted by the council`));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) => {
      settle();
      reject(e);
    });
    child.on("close", (code) => {
      settle();
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited with code ${code}: ${err.trim().slice(0, 400)}`));
    });
    child.stdin.on("error", () => {}); // EPIPE when the child exits early; surfaced via close
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

export const claudeCliAdapter: ProviderAdapter = {
  provider: "claude-cli",
  async complete(_modelId, prompt, _maxOutputTokens, options) {
    const text = await runCli(
      "claude",
      CLAUDE_ANSWER_ONLY_ARGS,
      prompt,
      RETAINED_TIMEOUT_MS,
      homedir(),
      options.signal,
    );
    return { text: text.trim(), usage: ZERO_USAGE };
  },
};

export const codexCliAdapter: ProviderAdapter = {
  provider: "codex-cli",
  async complete(_modelId, prompt, _maxOutputTokens, options) {
    const dir = mkdtempSync(join(tmpdir(), "symposium-codex-"));
    const lastMessageFile = join(dir, "last-message.txt");
    try {
      const stdout = await runCli(
        "codex",
        codexAnswerOnlyArgs(lastMessageFile),
        prompt,
        RETAINED_TIMEOUT_MS,
        homedir(),
        options.signal,
      );
      let text: string;
      try {
        text = readFileSync(lastMessageFile, "utf8");
      } catch {
        text = stdout; // -o file missing on success is version drift; fall back to transcript
      }
      return { text: text.trim(), usage: ZERO_USAGE };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

export const agyCliAdapter: ProviderAdapter = {
  provider: "agy-cli",
  async complete(_modelId, prompt, _maxOutputTokens, options) {
    const dir = mkdtempSync(join(tmpdir(), "symposium-agy-"));
    try {
      const text = await runCli(
        "agy",
        AGY_ANSWER_ONLY_ARGS,
        prompt,
        RETAINED_TIMEOUT_MS,
        dir,
        options.signal,
      );
      return { text: text.trim(), usage: ZERO_USAGE };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
