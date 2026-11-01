import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { green, red } from './format';

export type Level = 'info' | 'warn' | 'error' | 'event';

/** Console-only emphasis. Never serialised into the log records. */
export type Tone = 'up' | 'down' | 'neutral';

export interface LoggerOptions {
  dir?: string;
  toConsole?: boolean;
  /** Rotate a day's log at startup if it already exceeds this size. */
  maxBytes?: number;
}

interface LogRecord {
  time: string;
  level: Level;
  message: string;
  data?: Record<string, unknown>;
}

const LEVEL_LABEL: Record<Level, string> = {
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  event: 'EVENT',
};

const todayStamp = (): string => new Date().toISOString().slice(0, 10);

const endStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve) => {
    stream.end(() => resolve());
  });

const rotateIfNeeded = async (path: string, maxBytes: number): Promise<void> => {
  try {
    const info = await stat(path);
    if (info.size >= maxBytes) await rename(path, `${path}.${Date.now()}`);
  } catch {
    // Missing file is the normal case.
  }
};

/**
 * Non-blocking logger: appends go to buffered WriteStreams instead of
 * appendFileSync, so logging never becomes the bottleneck of a poll loop.
 *
 * Files are re-opened when the UTC date changes, so a monitor that runs for
 * weeks keeps writing to the correct day. Colour is applied to the console
 * copy only — log records stay plain ASCII.
 */
export class Logger {
  private readonly dir: string;
  private readonly toConsole: boolean;

  private stamp: string;
  private logStream: WriteStream;
  private eventStream: WriteStream;
  private closed = false;

  private constructor(dir: string, stamp: string, toConsole: boolean) {
    this.dir = dir;
    this.toConsole = toConsole;
    this.stamp = stamp;
    this.logStream = this.openStream(join(dir, `${stamp}.log`));
    this.eventStream = this.openStream(join(dir, `${stamp}.events.jsonl`));
  }

  public static async create(options: LoggerOptions = {}): Promise<Logger> {
    const dir = options.dir ?? './logs';
    const maxBytes = options.maxBytes ?? 5_000_000;
    await mkdir(dir, { recursive: true });

    const stamp = todayStamp();
    await rotateIfNeeded(join(dir, `${stamp}.log`), maxBytes);

    return new Logger(dir, stamp, options.toConsole ?? true);
  }

  public info(message: string, data?: Record<string, unknown>): void {
    this.write('info', message, data);
  }

  public warn(message: string, data?: Record<string, unknown>): void {
    this.write('warn', message, data);
  }

  public error(message: string, data?: Record<string, unknown>): void {
    this.write('error', message, data);
  }

  /** A balance change. Written to the JSONL event stream, not the main log. */
  public event(message: string, data?: Record<string, unknown>, tone: Tone = 'neutral'): void {
    this.write('event', message, data, tone);
  }

  public async close(): Promise<void> {
    this.closed = true;
    await Promise.all([endStream(this.logStream), endStream(this.eventStream)]);
  }

  private openStream(path: string): WriteStream {
    const stream = createWriteStream(path, { flags: 'a' });
    stream.on('error', (error: Error) => {
      console.error(`log stream error: ${error.message}`);
    });
    return stream;
  }

  /** Roll over to a new pair of files when the UTC date changes. */
  private ensureCurrentDay(): void {
    if (this.closed) return;
    const stamp = todayStamp();
    if (stamp === this.stamp) return;

    const previousLog = this.logStream;
    const previousEvents = this.eventStream;

    this.stamp = stamp;
    this.logStream = this.openStream(join(this.dir, `${stamp}.log`));
    this.eventStream = this.openStream(join(this.dir, `${stamp}.events.jsonl`));

    // Buffered writes on the old streams flush as they end.
    previousLog.end();
    previousEvents.end();
  }

  private write(level: Level, message: string, data?: Record<string, unknown>, tone: Tone = 'neutral'): void {
    this.ensureCurrentDay();

    const record: LogRecord = { time: new Date().toISOString(), level, message };
    if (data) record.data = data;

    const line = `${JSON.stringify(record)}\n`;
    if (level === 'event') {
      this.eventStream.write(line);
    } else {
      this.logStream.write(line);
    }

    if (this.toConsole) this.print(record, tone);
  }

  private print(record: LogRecord, tone: Tone): void {
    const time = record.time.slice(11, 19);
    const details = record.data
      ? ` ${Object.entries(record.data)
          .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(' ')}`
      : '';

    const line = `${time} ${LEVEL_LABEL[record.level]} ${record.message}${details}`;
    if (tone === 'up') console.log(green(line));
    else if (tone === 'down') console.log(red(line));
    else console.log(line);
  }
}
