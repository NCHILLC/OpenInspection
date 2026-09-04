export interface SectionDonutProps {
    rated: number;
    total: number;
    size?: number;
}

/**
 * Progress, and ONLY progress.
 *
 * `hasDefect` used to turn the whole ring red, so a fully-complete section with
 * one defect and a 10%-complete section with one defect were the same colour and
 * only ring geometry told them apart — at 18px, in glare, through a glove. Two
 * axes on one carrier. The defect flag is a separate badge now, and the fraction
 * beside this ring is what actually gets read; the ring is the glanceable half of
 * a pair, not the sole carrier of state.
 */
export function SectionDonut({ rated, total, size = 18 }: SectionDonutProps) {
    const stroke = 2.5;
    const radius = (size - stroke) / 2;
    const circ   = 2 * Math.PI * radius;
    const pct    = total === 0 ? 0 : Math.min(1, rated / total);
    const dash   = circ * pct;
    const color = (rated === total && total > 0) ? 'var(--ih-ok)' : 'var(--ih-fg-4)';
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeOpacity={0.2}
                strokeWidth={stroke}
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={circ / 4}
                transform={`rotate(-90 ${size/2} ${size/2})`}
                strokeLinecap="round"
            />
        </svg>
    );
}
