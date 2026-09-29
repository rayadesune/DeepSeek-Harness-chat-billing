import { jsx as _jsx } from "react/jsx-runtime";
/** Per-turn billed-cost label in the closing assistant message's actions row. */
import { useEffect, useState } from 'react';
import { formatSpend } from "./format.js";
import css from './TurnCostAction.module.css';
/**
 * Render one Turn's billed cost as a plain, non-interactive `¥金额` at the
 * end of the closing message's actions row. The DOM stays inside the
 * assistant-actions slot (between copy and branch); flex `order: 1` sorts the
 * span after every order-0 sibling, so it visually lands after the clock at
 * the line end. The typography replicates the clock's `.timeEnd` tier and the
 * row's 8px gap spaces it from the clock, so the amount reads as one trailing
 * meta line with the time; no icon, label or hover behavior of its own (the
 * row's hover reveal shows it with the clock). It appears only after the
 * shared map resolves and hides again when the Turn priced to zero (no DeepSeek
 * usage); a failed fetch stays hidden so a Remote outage never clutters the
 * row.
 * @param props - the closing message id, the session runtime share, and the injected cost reader.
 * @returns the cost text, or null while loading, on failure, or for zero cost.
 */
export function TurnCostAction({ messageId, sessionId, getTurnCost }) {
    const [cost, setCost] = useState(null);
    useEffect(() => {
        let current = true;
        void Promise.resolve()
            .then(() => getTurnCost(sessionId, messageId))
            .then((value) => { if (current)
            setCost(value ?? null); }, () => { if (current)
            setCost(null); });
        return () => { current = false; };
    }, [getTurnCost, messageId, sessionId]);
    if (cost === null || cost <= 0)
        return null;
    return (_jsx("span", { className: css.cost, "data-turn-cost": true, children: formatSpend(cost) }));
}
//# sourceMappingURL=TurnCostAction.js.map