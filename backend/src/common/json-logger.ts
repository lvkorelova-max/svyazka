import { LoggerService } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, trace?: string, context?: string) {
    this.write('fatal', message, context, trace);
  }

  private write(level: string, message: unknown, context?: string, trace?: string) {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context: context || 'Application',
      message: typeof message === 'string' ? message : this.safeValue(message),
      ...(trace ? { trace } : {}),
    });
    (['error', 'fatal'].includes(level) ? process.stderr : process.stdout).write(`${entry}\n`);
  }

  private safeValue(value: unknown) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
}
