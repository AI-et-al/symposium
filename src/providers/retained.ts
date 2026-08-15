import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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
 * Answer-only mode for `claude -p` (flags verified against claude 2.1.223):
 * user-level settings only (the seat carries its human's context, not whatever
 * project the MCP client launched from), no MCP servers, no session files, and
 * every built-in tool denied.
 */
export const CLAUDE_ANSWER_ONLY_ARGS: ReadonlyArray<string> = [
  "-p",
  "--output-format",
  "text",
  "--setting-sources",
  "user",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--disallowedTools",
  "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,Agent,Skill,NotebookEdit,TodoWrite",
];

/**
 * Answer-only mode for `codex exec` (flags verified against codex-cli 0.147.0):
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
 * Gemini CLI runs one-shot on piped stdin with no flags. Docs-derived, NOT verified
 * against a live install (none present at build time); the seat skips when the
 * binary is absent and any flag drift surfaces as a recorded error outcome.
 */
export const GEMINI_ANSWER_ONLY_ARGS: ReadonlyArray<string> = [];

/**
 * Run one CLI to completion: prompt on stdin, stdout collected, child killed on
 * timeout so no subprocess outlives its convening. cwd is the home directory —
 * retained context is the human's user-level config, not the server's cwd.
 */
export function runCli(
  command: string,
  args: ReadonlyArray<string>,
  prompt: string,
  timeoutMs: number = RETAINED_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: homedir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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
  async complete(_modelId, prompt, _maxOutputTokens, _options) {
    const text = await runCli("claude", CLAUDE_ANSWER_ONLY_ARGS, prompt);
    return { text: text.trim(), usage: ZERO_USAGE };
  },
};

export const codexCliAdapter: ProviderAdapter = {
  provider: "codex-cli",
  async complete(_modelId, prompt, _maxOutputTokens, _options) {
    const dir = mkdtempSync(join(tmpdir(), "symposium-codex-"));
    const lastMessageFile = join(dir, "last-message.txt");
    try {
      const stdout = await runCli("codex", codexAnswerOnlyArgs(lastMessageFile), prompt);
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

export const geminiCliAdapter: ProviderAdapter = {
  provider: "gemini-cli",
  async complete(_modelId, prompt, _maxOutputTokens, _options) {
    const text = await runCli("gemini", GEMINI_ANSWER_ONLY_ARGS, prompt);
    return { text: text.trim(), usage: ZERO_USAGE };
  },
};
