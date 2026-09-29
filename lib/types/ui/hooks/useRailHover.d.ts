export interface RailHoverState {
    hoveredConnectionId: string | null;
    hoveredSessionId: string | null;
}
export declare function useRailHover(): {
    state: RailHoverState;
    onConnectionEnter: (id: string) => void;
    onConnectionLeave: () => void;
    onSessionEnter: (id: string) => void;
    onSessionLeave: () => void;
};
