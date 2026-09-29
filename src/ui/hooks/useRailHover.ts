/**
 * useRailHover — 轨道悬停联动。
 * 悬停连接 → 高亮对应区间，其他暗淡。
 * 悬停会话节点 → 高亮所有相关区间。
 */
import { useState, useCallback } from 'react'

export interface RailHoverState {
  hoveredConnectionId: string | null
  hoveredSessionId: string | null
}

export function useRailHover() {
  const [state, setState] = useState<RailHoverState>({
    hoveredConnectionId: null,
    hoveredSessionId: null,
  })

  const onConnectionEnter = useCallback((id: string) => {
    setState((prev) => ({ ...prev, hoveredConnectionId: id }))
  }, [])

  const onConnectionLeave = useCallback(() => {
    setState((prev) => ({ ...prev, hoveredConnectionId: null }))
  }, [])

  const onSessionEnter = useCallback((id: string) => {
    setState((prev) => ({ ...prev, hoveredSessionId: id }))
  }, [])

  const onSessionLeave = useCallback(() => {
    setState((prev) => ({ ...prev, hoveredSessionId: null }))
  }, [])

  return {
    state,
    onConnectionEnter,
    onConnectionLeave,
    onSessionEnter,
    onSessionLeave,
  }
}
