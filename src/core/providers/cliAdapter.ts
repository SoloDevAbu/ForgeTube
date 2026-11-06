import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { ProviderError } from "../../shared/errors.js";
import { REPO_ROOT } from "../../shared/paths.js";

export interface ToolConfig {
  /** Python with edge_tts installed. */
  python: string | null;
  /** earshot launcher. */
  earshot: string | null;
}

export interface CliExecutionResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Local tool paths: environment first, then forgetube.config.json, then PATH. */
export async function loadToolConfig(): Promise<ToolConfig> {
  const configPath = path.join(REPO_ROOT, "forgetube.config.json");
  let file: Partial<ToolConfig> = {};
  if (existsSync(configPath)) {
    file = JSON.parse(await fs.readFile(configPath, "utf-8"));
  }
  return {
    python: process.env.FORGETUBE_PYTHON ?? file.python ?? Bun.which("python3") ?? Bun.which("python"),
    earshot: process.env.FORGETUBE_EARSHOT ?? file.earshot ?? Bun.which("earshot"),
  };
}

function launch(executable: string, args: string[], cwd?: string): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    // Batch launchers run through cmd.exe. Everything is quoted; quotes in values are removed.
    const quoted = [executable, ...args].map((a) => `"${a.replace(/"/g, "")}"`).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", `"${quoted}"`], {
      cwd,
      windowsVerbatimArguments: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Executes an external command with an argument array and a timeout.
 */
export async function runCliCommand(
  executable: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<CliExecutionResult> {
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let stdout = "";
    let stderr = "";
    let settled = false;

    try {
      child = launch(executable, args, options?.cwd);
    } catch (err: any) {
      return reject(new ProviderError(`Failed to launch "${executable}": ${err.message}`, { executable, args }));
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new ProviderError(`Timed out after ${timeoutMs} ms: ${executable}`, { executable, args }));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => (stdout += chunk.toString("utf-8")));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString("utf-8")));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProviderError(`Process error from "${executable}": ${err.message}`, { err }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command: executable, args, exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - startTime });
    });
  });
}
