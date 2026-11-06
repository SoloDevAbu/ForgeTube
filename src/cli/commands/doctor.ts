import { Command } from "commander";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadToolConfig, runCliCommand } from "../../core/providers/cliAdapter.js";
import { getLocalBrowserExecutable } from "../../core/render/browserLocator.js";
import { getMusicDir } from "../../core/audio/musicLibrary.js";
import { REPO_ROOT } from "../../shared/paths.js";
import { bad, guarded, ok, printOutput } from "../output.js";

interface Check {
  name: string;
  ok: boolean;
  /** A missing optional tool does not block a film. */
  optional: boolean;
  detail: string;
}

async function probe(executable: string | null, args: string[]): Promise<{ ok: boolean; detail: string }> {
  if (!executable) return { ok: false, detail: "not found" };
  try {
    const result = await runCliCommand(executable, args, { timeoutMs: 30_000 });
    const line = `${result.stdout}${result.stderr}`.trim().split("\n")[0] ?? "";
    return { ok: result.exitCode === 0, detail: line.trim() };
  } catch (err: any) {
    return { ok: false, detail: err.message };
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check the tools each stage needs")
    .action(
      guarded(program, async () => {
        const { python, earshot } = await loadToolConfig();
        const browser = getLocalBrowserExecutable();
        const musicDir = getMusicDir();
        const kokoro = existsSync(path.join(REPO_ROOT, "node_modules", "kokoro-js"));

        const checks: Check[] = [
          { name: "Node (render worker)", optional: false, ...(await probe(Bun.which("node"), ["--version"])) },
          { name: "FFmpeg", optional: false, ...(await probe("ffmpeg", ["-version"])) },
          { name: "ffprobe", optional: false, ...(await probe("ffprobe", ["-version"])) },
          { name: "Browser", optional: false, ok: Boolean(browser), detail: browser ?? "Set BROWSER_EXECUTABLE" },
          {
            name: "Edge TTS",
            optional: false,
            ...(await probe(python, ["-c", "import edge_tts; print('edge_tts', edge_tts.__version__)"])),
          },
          { name: "earshot", optional: true, ...(await probe(earshot, ["--help"])) },
          { name: "Kokoro (offline voice)", optional: true, ok: kokoro, detail: kokoro ? "installed" : "bun add kokoro-js" },
          { name: "music folder", optional: true, ok: existsSync(musicDir), detail: musicDir },
        ];

        printOutput(checks, program.opts().json, () => {
          for (const c of checks) {
            const line = `${c.name}: ${c.detail}`;
            if (c.ok) ok(line);
            else bad(`${line}${c.optional ? " (optional)" : ""}`);
          }
        });
        if (checks.some((c) => !c.ok && !c.optional)) process.exitCode = 1;
      })
    );
}
