export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 99,
};

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

export class Logger {
  private level: number;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = LEVELS[options.level ?? 'info'] ?? 1;
    this.prefix = options.prefix ? `[${options.prefix}] ` : '';
  }

  debug(msg: string, ...args: unknown[]): void {
    if (this.level <= LEVELS['debug']!) {
      console.debug(`${this.prefix}${msg}`, ...args);
    }
  }

  info(msg: string, ...args: unknown[]): void {
    if (this.level <= LEVELS['info']!) {
      console.info(`${this.prefix}${msg}`, ...args);
    }
  }

  warn(msg: string, ...args: unknown[]): void {
    if (this.level <= LEVELS['warn']!) {
      console.warn(`${this.prefix}${msg}`, ...args);
    }
  }

  error(msg: string, ...args: unknown[]): void {
    if (this.level <= LEVELS['error']!) {
      console.error(`${this.prefix}${msg}`, ...args);
    }
  }

  child(prefix: string): Logger {
    return new Logger({
      level: Object.entries(LEVELS).find(([, v]) => v === this.level)?.[0] as LogLevel,
      prefix: this.prefix ? `${this.prefix.replace(/^\[|\] $/g, '')}:${prefix}` : prefix,
    });
  }
}

// 默认全局 logger
export const logger = new Logger();
