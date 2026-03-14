// 核心类
export { Worker } from './worker.js';
export { LongTermMemory, buildConsolidationPrompt } from './long-term-memory.js';
export { SOUL_TEMPLATES, getSoulTemplate, listSoulTemplates } from './soul-templates.js';
export type { SoulTemplate } from './soul-templates.js';
export { Company } from './company.js';
export { Mailbox } from './mailbox.js';
export { MessageRouter } from './router.js';
export { ThreadManager } from './thread.js';
export { TokenTracker } from './token-tracker.js';
export { WorkerScheduler } from './worker-scheduler.js';
export { AuditLog } from './audit-log.js';

// 能力校验
export { validateCapabilities, assertCapabilities } from './capability-registry.js';
export type { CapabilityValidationError } from './capability-registry.js';

// 类型导出
export type { WorkerOptions, AsyncInboxService, AsyncTaskService } from './worker.js';
export type { CompanyOptions } from './company.js';
export type { TokenRecord, WorkerTokenSummary } from './token-tracker.js';
export type { SchedulerOptions, ReviewContext } from './worker-scheduler.js';
