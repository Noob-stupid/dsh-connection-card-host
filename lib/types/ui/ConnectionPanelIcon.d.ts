/**
 * ConnectionPanelIcon — sidebar.panellist 里的图标。
 *
 * 这个槽位**只放图标**（ownerProps 是 `{ size, active }`），点击由侧栏
 * 自己负责——它用 list 的 `id` 去 `main` 槽位找同名面板并切换过去。
 * 早期版本把整个面板塞进这里，于是侧栏出现溢出文案，是错的。
 *
 * 颜色用 currentColor，跟随侧栏的行内/悬停/选中配色。
 */
interface ConnectionPanelIconProps {
    /** 请求的方形边长（px），由侧栏给出。 */
    size: number;
    /** 该面板当前是否被选中。 */
    active: boolean;
}
export declare function ConnectionPanelIcon({ size, active }: ConnectionPanelIconProps): import("react").JSX.Element;
export {};
