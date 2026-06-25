export type LogLevel = "error" | "warn" | "info" | "debug" | "none";

/** Classify a log line by the highest-severity level token it contains. */
export function detectLevel(line: string): LogLevel {
  if (/\b(ERROR|ERR|FATAL|SEVERE|CRITICAL|CRIT|PANIC|EMERG|ALERT)\b/i.test(line)) return "error";
  if (/\b(WARN|WARNING)\b/i.test(line)) return "warn";
  if (/\b(INFO|NOTICE)\b/i.test(line)) return "info";
  if (/\b(DEBUG|TRACE|VERBOSE)\b/i.test(line)) return "debug";
  return "none";
}
