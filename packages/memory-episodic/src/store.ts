import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Episode, EpisodicStore } from '@bcc/foundation';

const DEFAULT_DIR = join(homedir(), '.bcc', 'episodes');

export interface FileEpisodicStoreOptions {
  /**
   * 情节记忆文件存储目录。
   * 默认：~/.bcc/episodes
   * 每个 Worker 对应目录下一个 {workerId}.json 文件。
   */
  dir?: string | undefined;
  /**
   * 每个 Worker 最多保留的情节条数（超出时删除最旧的）。
   * 默认 50，防止文件无限增长。
   */
  maxEpisodes?: number | undefined;
}

/**
 * FileEpisodicStore：基于文件系统的情节记忆存储。
 *
 * 实现 EpisodicStore 接口（定义于 @bcc/foundation），
 * 可替换为数据库实现而不影响 Worker 或 Channel 层代码。
 *
 * 存储格式：{dir}/{workerId}.json — 内容为 Episode[] 数组（按时间升序）。
 */
export class FileEpisodicStore implements EpisodicStore {
  private dir: string;
  private maxEpisodes: number;
  private initialized = false;

  constructor(options: FileEpisodicStoreOptions = {}) {
    this.dir = resolve(options.dir ?? DEFAULT_DIR);
    this.maxEpisodes = options.maxEpisodes ?? 50;
  }

  async append(episode: Episode): Promise<void> {
    await this.ensureDir();
    const existing = await this.loadAll(episode.workerId);
    existing.push(episode);

    // 超出上限时裁剪最旧的条目
    const trimmed = existing.length > this.maxEpisodes
      ? existing.slice(existing.length - this.maxEpisodes)
      : existing;

    await this.save(episode.workerId, trimmed);
  }

  async recent(workerId: string, limit: number): Promise<Episode[]> {
    const all = await this.loadAll(workerId);
    // loadAll 按时间升序，recent 返回最新的 N 条（倒序取再倒回）
    return all.slice(-limit).reverse();
  }

  async clear(workerId: string): Promise<void> {
    await this.save(workerId, []);
  }

  // ─── 内部方法 ─────────────────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    this.initialized = true;
  }

  private pathFor(workerId: string): string {
    // 只允许安全字符，防止路径穿越
    const safe = workerId.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  private async loadAll(workerId: string): Promise<Episode[]> {
    const path = this.pathFor(workerId);
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as Episode[];
    } catch {
      return [];
    }
  }

  private async save(workerId: string, episodes: Episode[]): Promise<void> {
    await this.ensureDir();
    await writeFile(this.pathFor(workerId), JSON.stringify(episodes, null, 2), 'utf-8');
  }
}
