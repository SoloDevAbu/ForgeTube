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

