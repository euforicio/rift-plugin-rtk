// bb-plugin-rtk — Rewrite Terminal Kommand for BB.
//
// Port of ogallotti/rtk-hermes: transparently rewrites shell commands
// through the `rtk` CLI proxy for 60-90% token savings on verbose output
// (builds, tests, git diffs, package manager output).
//
// Registers `rtk_shell` as a native agent tool:
//   rtk_shell "git status" → rewrites → runs through rtk → returns filtered output
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execCb);

// ─── Settings ────────────────────────────────────────────────────────

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("bb-plugin-rtk loaded");

  const settings = bb.settings.define({
    rtkPath: {
      type: "string" as const,
      label: "RTK binary path",
      default: "/opt/homebrew/bin/rtk",
      description: "Absolute path to the rtk binary (check with `which rtk`).",
    },
  });

  const { rtkPath } = await settings.get();

  // ── Agent tool: rtk_shell ─────────────────────────────────────────

  bb.agents.registerTool({
    name: "rtk_shell",
    description:
      "Run a shell command through RTK for filtered output (60-90% token savings). " +
      "Wraps your command: rtk_shell('git diff') rewrites and runs through rtk, " +
      "returning only the meaningful output. Use for verbose commands: builds, tests, " +
      "git diffs, cargo/build output, package installs. For commands where you need " +
      "unfiltered output (reading files, listing directories), use the terminal tool instead.",
    parameters: z.object({
      command: z
        .string()
        .min(1)
        .describe(
          "The shell command to run. Do NOT prefix with 'rtk' — this tool wraps it for you.",
        ),
    }),
    async execute({ command }, { threadId }) {
      try {
        bb.log.info(`[rtk] thread ${threadId}: ${command}`);

        // Step 1: rewrite — get the optimized command string
        const { stdout: rewritten } = await execAsync(`${rtkPath} rewrite ${shellEscape(command)}`, {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });

        const rtkCmd = rewritten.trim();
        bb.log.info(`[rtk] thread ${threadId}: rewrote → ${rtkCmd}`);

        // Step 2: execute the rewritten command through RTK as a shell command
        // `rtk rewrite` returns e.g. "rtk git diff" — run that verbatim
        const { stdout, stderr } = await execAsync(rtkCmd, {
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
    bb.log.info("bb-plugin-rtk disposed");
  });
}

// ─── Minimal shell-escaping for the rewrite pass ─────────────────────

function shellEscape(s: string): string {
  // Single-quote the argument, escaping embedded single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}
