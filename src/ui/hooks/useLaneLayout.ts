/**
 * useLaneLayout — 根据连接和会话顺序计算 lane 布局。
 */
import { useMemo } from 'react'
import type { Connection, RailLayout } from '../../types/index.js'
import { allocateLanes } from '../../core/lane-allocator.js'

export function useLaneLayout(
  connections: Connection[],
  sessionOrder: string[],
): RailLayout {
  return useMemo(
    () => allocateLanes(connections, sessionOrder),
    [connections, sessionOrder],
  )
}
