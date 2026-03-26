/**
 * BCC → scene-core 适配器
 *
 * 这是整个系统中唯一同时了解"BCC Worker 状态"和"scene-core 实体格式"的文件。
 * 架构边界：此文件之外，scene-core 对 BCC 一无所知；BCC 对 scene-core 也不依赖。
 *
 * 未来如果 scene 系统独立部署，只需将此文件的逻辑搬到 HTTP adapter 层即可。
 */

import type { EntityInput, EntityPresence } from '@bcc/scene-core';
import type { ApiWorker } from '../types.js';

/**
 * workerToEntityInput：将 BCC Worker 的运行时状态转换为 SceneEngine 输入。
 *
 * 映射规则：
 *   offline → offline
 *   busy    → working（Worker 正在处理消息）
 *   online  → idle（Worker 在线但空闲）
 *
 * 会议状态（meeting）由调用方通过 hints 注入，因为 BCC 本身没有"会议"概念，
 * 需要靠 Thread 参与者分析来推断。
 */
export function workerToEntityInput(
  worker: { id: string; name: string; avatar?: string; modelId?: string },
  status: ApiWorker['status'],
  hints?: {
    isMeeting?: boolean;
    isFocus?: boolean;
    activityLabel?: string;
    preferredZoneId?: string;
  },
): EntityInput {
  const presence = resolvePresence(status, hints);
  return {
    id: `worker:${worker.id}`,
    displayName: worker.name,
    avatar: worker.avatar ?? '🤖',
    presence,
    activityLabel: hints?.activityLabel ?? defaultActivityLabel(presence),
    ...(hints?.preferredZoneId !== undefined && { preferredZoneId: hints.preferredZoneId }),
    meta: { workerId: worker.id, modelId: worker.modelId ?? '' },
  };
}

function resolvePresence(
  status: ApiWorker['status'],
  hints?: { isMeeting?: boolean; isFocus?: boolean },
): EntityPresence {
  if (status === 'offline') return 'offline';
  if (hints?.isMeeting) return 'meeting';
  if (status === 'busy' && hints?.isFocus) return 'focus';
  if (status === 'busy') return 'working';
  return 'idle';
}

function defaultActivityLabel(presence: EntityPresence): string {
  switch (presence) {
    case 'working': return '处理中';
    case 'meeting': return '会议中';
    case 'focus':   return '专注工作';
    case 'offline': return '离线';
    case 'idle':
    default:        return '空闲中';
  }
}
