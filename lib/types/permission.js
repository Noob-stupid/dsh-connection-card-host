export const PERMISSION_ORDER = {
    read: 0,
    suggest: 1,
    write: 2,
};
export function permValue(level) {
    return PERMISSION_ORDER[level];
}
export function permFromValue(value) {
    if (value >= 2)
        return 'write';
    if (value >= 1)
        return 'suggest';
    return 'read';
}
//# sourceMappingURL=permission.js.map