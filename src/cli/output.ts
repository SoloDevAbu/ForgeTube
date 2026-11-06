export function printOutput(data: unknown, isJson = false, textFormatter?: () => void): void {
  if (isJson) {
    console.log(JSON.stringify(data, null, 2));
  } else if (textFormatter) {
    textFormatter();
  } else if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(data);
  }
}

export function printError(err: any, isJson = false): void {
  if (isJson) {
    console.error(
      JSON.stringify(
        {
          error: true,
          message: err.message,
          code: err.code || "UNKNOWN_ERROR",
          details: err.details,
        },
        null,
        2
      )
    );
  } else {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
    if (err.details) {
      console.error(JSON.stringify(err.details, null, 2));
    }
  }
}


/** Wraps a command so failures print cleanly and set the exit code. */
export function guarded<T extends unknown[]>(program: { opts(): any }, action: (...args: T) => Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await action(...args);
    } catch (err: any) {
      printError(err, program.opts().json);
      process.exitCode = 1;
    }
  };
}

export function ok(message: string): void {
  console.log(`\x1b[32m✔\x1b[0m ${message}`);
}

export function bad(message: string): void {
  console.log(`\x1b[31m✖\x1b[0m ${message}`);
}

/** Prints problems only, so a check costs little to read. */
export function printIssues(report: { errors: string[]; warnings: string[] }): void {
  for (const e of report.errors) console.log(`  error: ${e}`);
  for (const w of report.warnings) console.log(`  warn:  ${w}`);
}
