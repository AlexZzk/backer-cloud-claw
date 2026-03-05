export class BccError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BccError';
  }
}

export class ModelError extends BccError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MODEL_ERROR', cause);
    this.name = 'ModelError';
  }
}

export class ModelUnavailableError extends BccError {
  constructor(public readonly modelId: string, cause?: unknown) {
    super(`Model "${modelId}" is unavailable`, 'MODEL_UNAVAILABLE', cause);
    this.name = 'ModelUnavailableError';
  }
}

export class AllModelsFailedError extends BccError {
  constructor(public readonly errors: Error[]) {
    // 把每个子错误的关键信息提取出来，作为主消息的一部分
    const details = errors
      .map((e, i) => {
        const status = (e as { status?: number }).status;
        const statusStr = status ? ` [HTTP ${status}]` : '';
        return `  ${i + 1}. ${e.message}${statusStr}`;
      })
      .join('\n');
    super(
      errors.length > 0
        ? `All models failed:\n${details}`
        : 'All models failed (no errors recorded)',
      'ALL_MODELS_FAILED',
    );
    this.name = 'AllModelsFailedError';
  }
}

export class ConfigError extends BccError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
