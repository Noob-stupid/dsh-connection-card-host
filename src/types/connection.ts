import type { PermissionLevel } from './permission.js'
import type { CardInstance } from './card.js'

export type ConnectionStatus =
  | 'active'
  | 'paused'
  | 'pending_permission'
  | 'broken'
  | 'session_offline'

export type HealthStatus = 'green' | 'yellow' | 'red'

export interface Connection {
  id: string
  sessionA: string
  sessionB: string
  permission: {
    aToB: PermissionLevel
    bToA: PermissionLevel
  }
  status: ConnectionStatus
  health: HealthStatus
  cards: CardInstance[]
  createdAt: number
  updatedAt: number
}

export interface LaneAssignment {
  connectionId: string
  laneIndex: number
  startIndex: number
  endIndex: number
}

export interface Lane {
  index: number
  connections: string[]
}

export interface RailLayout {
  lanes: Lane[]
  connections: Map<string, LaneAssignment>
}
