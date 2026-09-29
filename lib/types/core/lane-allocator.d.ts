/**
 * Lane 分配算法 — 贪心区间着色。
 * 共享端点（A-B 和 B-C）不算重叠，可同 lane。
 * 区间方向无关，按 start/end 排序。
 */
import type { Connection, RailLayout } from '../types/index.js';
export declare function allocateLanes(connections: Connection[], sessionOrder: string[]): RailLayout;
