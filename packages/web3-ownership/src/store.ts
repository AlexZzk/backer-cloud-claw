/**
 * OwnershipStore — 文件系统持久化实现
 *
 * 所有权数据持久化到 ~/.bcc/ownership.json
 * 零外部依赖，使用 Node.js fs/promises。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { OwnershipRecord, OwnerableEntityType } from './types.js';

const DEFAULT_DIR = join(homedir(), '.bcc');
const DEFAULT_FILE = join(DEFAULT_DIR, 'ownership.json');

/** 本地存储格式：以 "type:id" 为 key 的对象 */
type OwnershipStore = Record<string, OwnershipRecord>;

export class FileOwnershipStore {
  private readonly filePath: string;
  private cache: OwnershipStore | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_FILE;
  }

  // ── 内部读写 ────────────────────────────────────────────────────────────────

  private async load(): Promise<OwnershipStore> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as OwnershipStore;
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private async persist(store: OwnershipStore): Promise<void> {
    await mkdir(DEFAULT_DIR, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
    this.cache = store;
  }

  private static key(type: OwnerableEntityType, id: string): string {
    return `${type}:${id}`;
  }

  // ── 公共 API ─────────────────────────────────────────────────────────────

  async get(type: OwnerableEntityType, id: string): Promise<OwnershipRecord | null> {
    const store = await this.load();
    return store[FileOwnershipStore.key(type, id)] ?? null;
  }

  async set(record: OwnershipRecord): Promise<void> {
    const store = await this.load();
    store[FileOwnershipStore.key(record.entityType, record.entityId)] = record;
    await this.persist(store);
  }

  async listAll(): Promise<OwnershipRecord[]> {
    const store = await this.load();
    return Object.values(store);
  }

  async listByOwner(ownerId: string): Promise<OwnershipRecord[]> {
    const all = await this.listAll();
    return all.filter(r => r.ownerId === ownerId);
  }

  async listByType(type: OwnerableEntityType): Promise<OwnershipRecord[]> {
    const all = await this.listAll();
    return all.filter(r => r.entityType === type);
  }

  /** 清空缓存（用于测试） */
  clearCache(): void {
    this.cache = null;
  }
}
