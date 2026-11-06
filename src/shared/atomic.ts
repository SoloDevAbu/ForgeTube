import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Sleeps for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomically writes data to a file by writing to a unique temporary file
 * in the same directory first, then renaming it to the target file.
 * Handles Windows EPERM / EBUSY file-locking locks with retry and fallback.
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });

  const randomSuffix = crypto.randomBytes(6).toString("hex");
  const tempPath = path.join(dir, `.${path.basename(resolved)}.tmp-${randomSuffix}`);

  try {
    await fs.writeFile(tempPath, data, "utf-8");

    // Retry loop for Windows filesystem locking
    let renamed = false;
    let lastError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tempPath, resolved);
        renamed = true;
        break;
      } catch (err: any) {
        lastError = err;
        if (err.code === "EPERM" || err.code === "EBUSY") {
          await sleep(25 * (attempt + 1));
        } else {
          throw err;
        }
      }
    }

    if (!renamed) {
      // Fallback on Windows if rename is locked: copy and unlink
      try {
        await fs.copyFile(tempPath, resolved);
        await fs.unlink(tempPath).catch(() => {});
      } catch {
        throw lastError;
      }
    }
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}

/**
 * Atomically writes a JSON-serializable object with pretty formatting.
 */
export async function atomicWriteJson<T>(filePath: string, data: T): Promise<void> {
  const serialized = JSON.stringify(data, null, 2) + "\n";
  await atomicWriteFile(filePath, serialized);
}

/**
 * Reads and parses a JSON file safely.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}
