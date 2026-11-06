import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { ProviderError } from "../../shared/errors.js";
import { sanitizeLogData, type Logger } from "../../shared/logger.js";

export interface ProviderConfig {
  researchExecutable?: string;
  researchArgsTemplate?: string[]; // e.g. ["--prompt-file", "{promptFile}", "--out", "{outputFile}"]
  llmExecutable?: string;
  llmArgsTemplate?: string[];
  ttsExecutable?: string;
  ttsArgsTemplate?: string[];
}

export interface CliExecutionResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Loads the user's local configuration from ~/.video-studio/config.json if it exists.
 */
export async function loadUserConfig(): Promise<ProviderConfig> {
  const configPath = path.join(os.homedir(), ".video-studio", "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw) as ProviderConfig;
  } catch {
    return {};
  }
}

/**
 * Executes an external command safely using an argument array, with timeout and cancellation.
 */
export async function runCliCommand(
  executable: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    logger?: Logger;
  }
): Promise<CliExecutionResult> {
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let stdout = "";
    let stderr = "";
    let isSettled = false;

    try {
      child = spawn(executable, args, {
        cwd: options?.cwd,
        signal: options?.abortSignal,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      return reject(
        new ProviderError(
          `Failed to launch executable "${executable}": ${err.message}`,
          { executable, args }
        )
      );
    }

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        reject(
          new ProviderError(
            `CLI execution timed out after ${timeoutMs}ms: ${executable}`,
            { executable, args }
          )
        );
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        reject(new ProviderError(`Process error from "${executable}": ${err.message}`, { err }));
      }
    });

    child.on("close", (code) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          command: executable,
          args,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs,
        });
      }
    });
  });
}

