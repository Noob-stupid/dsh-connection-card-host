import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const HEALTH_COLORS = {
    green: '#10B981',
    yellow: '#F59E0B',
    red: '#EF4444',
};
export function CardStack({ connection }) {
    if (connection.cards.length === 0) {
        return null;
    }
    return (_jsx("div", { className: "card-stack", children: connection.cards.map((card) => (_jsxs("div", { className: "card-row", children: ["\u251C ", card.templateId, ' ', _jsx("span", { style: {
                        color: HEALTH_COLORS[connection.health],
                        marginLeft: 6,
                    }, children: "\u25CF \u6B63\u5E38" })] }, card.instanceId))) }));
}
//# sourceMappingURL=CardStack.js.map