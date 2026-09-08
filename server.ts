// bb-plugin-rtk — Rewrite Terminal Kommand for BB.
//
// Port of ogallotti/rtk-hermes: an opt-in shell tool that rewrites the
// agent's shell commands through the `rtk` CLI proxy for token savings on
// verbose output (builds, tests, git diffs, package manager output).
//
// This plugin ONLY affects commands the agent explicitly sends through the
// `rtk_shell` tool — it does not touch bb's built-in terminal. It requires
// the external `rtk` CLI to be installed. It is an unrestricted shell tool:
// commands run with the project's working directory and full user privileges.
//
// Registers `rtk_shell` as a native agent tool:
//   rtk_shell "git status" → rewrites → runs through rtk → returns filtered output
import { type RiftPluginApi } from "@riftlabs/plugin-sdk";
import { z } from "zod";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(execCb);

// ─── Settings ────────────────────────────────────────────────────────

export default async function plugin(bb: RiftPluginApi) {
  bb.log.info("rift-plugin-rtk loaded");

  const settings = bb.settings.define({
    rtkPath: {
      type: "string" as const,
      label: "RTK binary path",
      default: "",
      description: "Absolute path to the rtk binary. Empty = auto-detect with `which rtk`.",
    },
  });

  let { rtkPath } = await settings.get();

  settings.onChange((next) => {
    rtkPath = next.rtkPath;
    bb.log.info(`[rtk] rtkPath updated → ${rtkPath || "(auto-detect)"}`);
  });

  // Resolve the rtk binary: explicit setting wins, otherwise `which rtk`.
  // Returns a clear error message when rtk is not installed.
  async function resolveRtkPath(): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
    if (rtkPath && rtkPath.trim()) {
      const p = rtkPath.trim();
      if (existsSync(p)) return { ok: true, path: p };
      return {
        ok: false,
        message: `rtk not installed at "${p}". Set the "RTK binary path" setting (check with \`which rtk\`).`,
      };
    }
    try {
      const { stdout } = await execAsync("which rtk", { timeout: 5_000 });
      const p = stdout.trim();
      if (p) return { ok: true, path: p };
    } catch {
      // fall through
    }
    return {
      ok: false,
      message: "rtk is not installed. Install the rtk CLI first (see https://github.com/ogallotti/rtk-hermes), then set the RTK binary path in plugin settings if it is not on PATH.",
    };
  }

  // Resolve the project directory for a tool call so commands run in the
  // project's working directory, not the bb server process cwd.
  async function resolveProjectDir(projectId: string): Promise<string | null> {
    try {
      const project = await bb.sdk.projects.get({ projectId });
      const source = project?.sources?.find((s: any) => s.type === "local_path");
      if (source?.path) return source.path;
    } catch {
      // fall through
    }
    return null;
  }

  // ── Agent tool: rtk_shell ─────────────────────────────────────────

  bb.agents.registerTool({
    name: "rtk_shell",
    description:
      "Run a shell command through RTK for filtered output (token savings on verbose commands). " +
      "Wraps your command: rtk_shell('git diff') rewrites and runs through rtk, " +
      "returning only the meaningful output. Use for verbose commands: builds, tests, " +
      "git diffs, cargo/build output, package installs. Requires the external rtk CLI. " +
      "This tool does NOT change bb's built-in terminal — only commands sent through rtk_shell " +
      "are filtered. It is an unrestricted shell tool: use with the same care as the terminal. " +
      "For commands where you need unfiltered output (reading files, listing directories), use the terminal tool instead.",
    parameters: z.object({
      command: z
        .string()
        .min(1)
        .describe(
          "The shell command to run. Do NOT prefix with 'rtk' — this tool wraps it for you.",
        ),
    }),
    async execute({ command }, { threadId, projectId }) {
      try {
        const resolved = await resolveRtkPath();
        if (!resolved.ok) return `rtk_shell: ${resolved.message}`;
        const rtk = resolved.path;

        const cwd = (await resolveProjectDir(projectId)) ?? undefined;
        bb.log.info(`[rtk] thread ${threadId}${cwd ? ` (cwd: ${cwd})` : ""}: ${command}`);

        // Step 1: rewrite — get the optimized command string
        const { stdout: rewritten } = await execAsync(`${rtk} rewrite ${shellEscape(command)}`, {
          cwd,
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });

        const rtkCmd = rewritten.trim();
        bb.log.info(`[rtk] thread ${threadId}: rewrote → ${rtkCmd}`);

        // Step 2: execute the rewritten command through RTK as a shell command
        // `rtk rewrite` returns e.g. "rtk git diff" — run that verbatim
        const { stdout, stderr } = await execAsync(rtkCmd, {
          cwd,
          timeout: 300_000,
          maxBuffer: 2 * 1024 * 1024,
        });

        const parts: string[] = [];
        if (stdout) parts.push(stdout.trimEnd());
        if (stderr) parts.push(`\n[stderr]\n${stderr.trimEnd()}`);
        return parts.join("") || "(no output)";
      } catch (err: any) {
        const stdout = err.stdout?.trim() ?? "";
        const stderr = err.stderr?.trim() ?? "";
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`\n[exit ${err.code ?? 1}]\n${stderr}`);
        return parts.join("") || `rtk_shell: command failed (exit ${err.code ?? "unknown"})`;
      }
    },
  });

  // ── Cleanup ──────────────────────────────────────────────────────

  bb.onDispose(() => {
    bb.log.info("rift-plugin-rtk disposed");
  });
}

// ─── Minimal shell-escaping for the rewrite pass ─────────────────────

function shellEscape(s: string): string {
  // Single-quote the argument, escaping embedded single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}
