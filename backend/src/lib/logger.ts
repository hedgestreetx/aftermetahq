type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown> & { requestId?: string };

function formatPayload(level: LogLevel, message: string, fields?: LogFields) {
  const time = new Date().toISOString();
  const base: Record<string, unknown> = {
    level,
    time,
    msg: message,
  };

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      base[key] = value;
    }
  }

  return JSON.stringify(base);
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  const line = formatPayload(level, message, fields);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields);
  },
};
