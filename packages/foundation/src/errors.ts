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
    super('All models failed', 'ALL_MODELS_FAILED');
    this.name = 'AllModelsFailedError';
  }
}

export class ConfigError extends BccError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}
