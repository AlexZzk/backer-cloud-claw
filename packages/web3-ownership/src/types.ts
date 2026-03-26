/**
 * @bcc/web3-ownership — Web3 所有权类型定义
 *
 * 设计理念：
 * - MVP 阶段：文件系统持久化，模拟 NFT 所有权
 * - 未来升级：替换 store 实现即可接入真实链上合约
 * - 结构与 ERC-721 NFT 标准对齐，方便后续链上迁移
 */

// ─── 可被拥有的实体类型 ────────────────────────────────────────────────────────

/**
 * OwnerableEntityType：可以被拥有、转让、出售的实体类型。
 *
 * - scene:   办公室场景（办公室、游戏工作室等）
 * - worker:  AI Worker（员工）
 * - company: 整个公司（包含所有场景和 Worker）
 */
export type OwnerableEntityType = 'scene' | 'worker' | 'company';

// ─── NFT 元数据 ──────────────────────────────────────────────────────────────

/**
 * NftMetadata：虚拟 NFT 元数据（与 ERC-721 metadata 标准对齐）。
 *
 * MVP 阶段为可选字段；真实链上部署后填充 contractAddress 和 tokenId。
 */
export interface NftMetadata {
  /** 合约地址（未上链时为 undefined） */
  contractAddress?: string;
  /** Token ID（未上链时为 undefined） */
  tokenId?: string;
  /** 链 ID（如 1=Ethereum, 137=Polygon, 8453=Base） */
  chainId?: number;
  /** Metadata JSON URI (IPFS / HTTP) */
  metadataUri?: string;
  /** 铸造时间戳（ms） */
  mintedAt?: number;
}

// ─── 挂牌出售 ─────────────────────────────────────────────────────────────────

export type ListingStatus = 'not_listed' | 'listed' | 'sold';

/**
 * MarketListing：挂牌出售信息。
 */
export interface MarketListing {
  status: ListingStatus;
  /** 定价（以 BCC Token 计，MVP 为模拟货币） */
  price?: number;
  /** 货币单位，如 "BCC"、"ETH"、"USDC" */
  currency?: string;
  /** 挂牌时间（ms） */
  listedAt?: number;
  /** 成交时间（ms） */
  soldAt?: number;
}

// ─── 所有权转让记录 ───────────────────────────────────────────────────────────

/**
 * OwnershipTransfer：一次所有权转让的历史记录。
 *
 * from 和 to 为所有者 ID（钱包地址或用户 ID）。
 * price 为成交价（0 表示赠送/系统初始化）。
 */
export interface OwnershipTransfer {
  from: string;
  to: string;
  price: number;
  currency: string;
  timestamp: number;
  /** 链上交易哈希（未上链时为 undefined） */
  txHash?: string;
  /** 转让备注（赠送原因 / 成交描述） */
  note?: string;
}

// ─── 所有权记录 ───────────────────────────────────────────────────────────────

/**
 * OwnershipRecord：一个实体的完整所有权信息。
 *
 * 这是 @bcc/web3-ownership 的核心数据结构。
 * 每个可交易实体（scene/worker/company）都有一条 OwnershipRecord。
 */
export interface OwnershipRecord {
  /** 实体类型 */
  entityType: OwnerableEntityType;
  /** 实体 ID（sceneId / workerId / 'default-company'） */
  entityId: string;
  /** 当前所有者 ID */
  ownerId: string;
  /** 所有权获取时间（ms） */
  acquiredAt: number;
  /** NFT 元数据（可选，未上链时为 undefined） */
  nft?: NftMetadata;
  /** 挂牌出售信息 */
  listing: MarketListing;
  /** 转让历史记录（最旧的在前） */
  transferHistory: OwnershipTransfer[];
}

// ─── 市场挂牌列表（聚合视图）─────────────────────────────────────────────────

/**
 * MarketplaceItem：出售市场中的一条挂牌项。
 *
 * 聚合了 OwnershipRecord 和实体元数据，供前端列表展示。
 */
export interface MarketplaceItem {
  entityType: OwnerableEntityType;
  entityId: string;
  /** 实体展示名称（由调用方注入） */
  entityName: string;
  /** 实体描述 */
  entityDescription?: string;
  ownerId: string;
  price: number;
  currency: string;
  listedAt: number;
  nft?: NftMetadata;
}

// ─── 转让请求 ────────────────────────────────────────────────────────────────

export interface TransferRequest {
  entityType: OwnerableEntityType;
  entityId: string;
  fromOwnerId: string;
  toOwnerId: string;
  price?: number;
  currency?: string;
  note?: string;
}

// ─── 挂牌请求 ────────────────────────────────────────────────────────────────

export interface ListForSaleRequest {
  entityType: OwnerableEntityType;
  entityId: string;
  ownerId: string;
  price: number;
  currency?: string;
}

// ─── 下架请求 ─────────────────────────────────────────────────────────────────

export interface DelistRequest {
  entityType: OwnerableEntityType;
  entityId: string;
  ownerId: string;
}
