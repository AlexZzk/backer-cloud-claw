/**
 * OwnershipManager — Web3 所有权管理核心
 *
 * 负责：
 * 1. 初始化实体所有权（首次注册时创建记录）
 * 2. 转让所有权（transfer）
 * 3. 挂牌/下架出售（list / delist）
 * 4. 查询市场列表（marketplace）
 * 5. 模拟"购买"（buy）
 *
 * 设计原则：
 * - 零链依赖，纯逻辑层，store 可插拔
 * - 结构预留了链上升级路径（txHash、contractAddress 等）
 */

import { randomUUID } from 'node:crypto';
import type {
  OwnershipRecord,
  OwnerableEntityType,
  TransferRequest,
  ListForSaleRequest,
  DelistRequest,
  MarketplaceItem,
} from './types.js';
import { FileOwnershipStore } from './store.js';

/** 系统默认所有者（未设置时属于"组织默认"） */
export const DEFAULT_OWNER_ID = 'org:default';

/** 默认货币单位 */
export const DEFAULT_CURRENCY = 'BCC';

export class OwnershipManager {
  private readonly store: FileOwnershipStore;

  constructor(storePath?: string) {
    this.store = new FileOwnershipStore(storePath);
  }

  // ── 初始化 ──────────────────────────────────────────────────────────────

  /**
   * ensureRecord：确保实体有所有权记录，不存在则创建默认记录。
   * 在服务器启动时对所有 scene/worker/company 调用一次即可。
   */
  async ensureRecord(
    type: OwnerableEntityType,
    id: string,
    ownerId: string = DEFAULT_OWNER_ID,
  ): Promise<OwnershipRecord> {
    const existing = await this.store.get(type, id);
    if (existing) return existing;

    const record: OwnershipRecord = {
      entityType: type,
      entityId: id,
      ownerId,
      acquiredAt: Date.now(),
      listing: { status: 'not_listed' },
      transferHistory: [],
    };
    await this.store.set(record);
    return record;
  }

  // ── 查询 ────────────────────────────────────────────────────────────────

  async getRecord(type: OwnerableEntityType, id: string): Promise<OwnershipRecord | null> {
    return this.store.get(type, id);
  }

  async listByOwner(ownerId: string): Promise<OwnershipRecord[]> {
    return this.store.listByOwner(ownerId);
  }

  async listByType(type: OwnerableEntityType): Promise<OwnershipRecord[]> {
    return this.store.listByType(type);
  }

  // ── 转让 ────────────────────────────────────────────────────────────────

  /**
   * transfer：转让所有权。
   *
   * - 可以是赠送（price=0）或成交（price>0）
   * - 写入转让历史
   * - 如果当前挂牌，自动下架
   */
  async transfer(req: TransferRequest): Promise<OwnershipRecord> {
    let record = await this.store.get(req.entityType, req.entityId);
    if (!record) {
      record = await this.ensureRecord(req.entityType, req.entityId, req.fromOwnerId);
    }

    if (record.ownerId !== req.fromOwnerId) {
      throw new Error(
        `Transfer failed: current owner is ${record.ownerId}, not ${req.fromOwnerId}`,
      );
    }

    const transfer = {
      from: req.fromOwnerId,
      to: req.toOwnerId,
      price: req.price ?? 0,
      currency: req.currency ?? DEFAULT_CURRENCY,
      timestamp: Date.now(),
      note: req.note,
    };

    const updated: OwnershipRecord = {
      ...record,
      ownerId: req.toOwnerId,
      acquiredAt: Date.now(),
      listing: { status: 'not_listed' },  // 自动下架
      transferHistory: [...record.transferHistory, transfer],
    };

    await this.store.set(updated);
    return updated;
  }

  // ── 挂牌出售 ─────────────────────────────────────────────────────────────

  /**
   * listForSale：挂牌出售。
   */
  async listForSale(req: ListForSaleRequest): Promise<OwnershipRecord> {
    let record = await this.store.get(req.entityType, req.entityId);
    if (!record) {
      record = await this.ensureRecord(req.entityType, req.entityId, req.ownerId);
    }

    if (record.ownerId !== req.ownerId) {
      throw new Error(`List failed: only owner ${record.ownerId} can list this entity`);
    }

    const updated: OwnershipRecord = {
      ...record,
      listing: {
        status: 'listed',
        price: req.price,
        currency: req.currency ?? DEFAULT_CURRENCY,
        listedAt: Date.now(),
      },
    };

    await this.store.set(updated);
    return updated;
  }

  /**
   * delist：下架出售。
   */
  async delist(req: DelistRequest): Promise<OwnershipRecord> {
    const record = await this.store.get(req.entityType, req.entityId);
    if (!record) throw new Error(`Entity ${req.entityType}:${req.entityId} not found`);

    if (record.ownerId !== req.ownerId) {
      throw new Error(`Delist failed: only owner ${record.ownerId} can delist this entity`);
    }

    const updated: OwnershipRecord = {
      ...record,
      listing: { status: 'not_listed' },
    };

    await this.store.set(updated);
    return updated;
  }

  // ── 市场 ────────────────────────────────────────────────────────────────

  /**
   * getMarketplace：返回所有正在出售的实体。
   *
   * entityNames：调用方提供的 id→name 映射，用于丰富展示信息。
   */
  async getMarketplace(
    entityNames?: Map<string, string>,
    entityDescriptions?: Map<string, string>,
  ): Promise<MarketplaceItem[]> {
    const all = await this.store.listAll();
    return all
      .filter(r => r.listing.status === 'listed' && r.listing.price !== undefined)
      .map(r => ({
        entityType: r.entityType,
        entityId: r.entityId,
        entityName: entityNames?.get(r.entityId) ?? r.entityId,
        entityDescription: entityDescriptions?.get(r.entityId),
        ownerId: r.ownerId,
        price: r.listing.price!,
        currency: r.listing.currency ?? DEFAULT_CURRENCY,
        listedAt: r.listing.listedAt ?? r.acquiredAt,
        nft: r.nft,
      }));
  }

  /**
   * buy：模拟购买（MVP 阶段不涉及真实链上结算）。
   *
   * 实际上就是一次 transfer，price 取自挂牌价。
   */
  async buy(
    entityType: OwnerableEntityType,
    entityId: string,
    buyerId: string,
  ): Promise<OwnershipRecord> {
    const record = await this.store.get(entityType, entityId);
    if (!record) throw new Error(`Entity ${entityType}:${entityId} not found`);
    if (record.listing.status !== 'listed') {
      throw new Error(`Entity ${entityType}:${entityId} is not listed for sale`);
    }

    return this.transfer({
      entityType,
      entityId,
      fromOwnerId: record.ownerId,
      toOwnerId: buyerId,
      price: record.listing.price ?? 0,
      currency: record.listing.currency ?? DEFAULT_CURRENCY,
      note: `Market purchase by ${buyerId}`,
    });
  }

  // ── 公司整体出售 ──────────────────────────────────────────────────────────

  /**
   * transferCompany：出售整个公司（批量转让所有实体）。
   *
   * 将公司记录、所有 scene 和 worker 的所有权一并转让给新所有者。
   * 返回所有被转让的记录。
   */
  async transferCompany(
    companyId: string,
    fromOwnerId: string,
    toOwnerId: string,
    price?: number,
  ): Promise<OwnershipRecord[]> {
    const all = await this.store.listAll();

    // 先验证公司所有权
    const companyRecord = await this.store.get('company', companyId);
    if (!companyRecord) {
      throw new Error(`Company ${companyId} not found`);
    }
    if (companyRecord.ownerId !== fromOwnerId) {
      throw new Error(`Company owner mismatch: expected ${companyRecord.ownerId}`);
    }

    // 同属该 owner 的所有 scene + worker
    const belongingRecords = all.filter(
      r => r.ownerId === fromOwnerId && r.entityType !== 'company',
    );

    const currency = DEFAULT_CURRENCY;
    const now = Date.now();
    const results: OwnershipRecord[] = [];

    for (const record of [companyRecord, ...belongingRecords]) {
      const transfer = {
        from: fromOwnerId,
        to: toOwnerId,
        price: price ?? 0,
        currency,
        timestamp: now,
        note: `Company sale: ${companyId}`,
      };
      const updated: OwnershipRecord = {
        ...record,
        ownerId: toOwnerId,
        acquiredAt: now,
        listing: { status: 'not_listed' },
        transferHistory: [...record.transferHistory, transfer],
      };
      await this.store.set(updated);
      results.push(updated);
    }

    return results;
  }

  // ── NFT 元数据 ─────────────────────────────────────────────────────────────

  /**
   * setNftMetadata：设置 NFT 元数据（真实上链后调用）。
   */
  async setNftMetadata(
    type: OwnerableEntityType,
    id: string,
    nft: NonNullable<OwnershipRecord['nft']>,
  ): Promise<OwnershipRecord> {
    const record = await this.store.get(type, id);
    if (!record) throw new Error(`Entity ${type}:${id} not found`);

    const updated = { ...record, nft };
    await this.store.set(updated);
    return updated;
  }

  /** 生成一个虚拟 Token ID（上链前占位用） */
  static generateVirtualTokenId(): string {
    return randomUUID();
  }
}
