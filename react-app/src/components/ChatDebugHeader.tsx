import { ChatScrollManager } from "../ChatScrollManager";
import { signalObserver } from "../utils";
import "./ChatDebugHeader.css";

interface ChatDebugHeaderProps {
    manager: ChatScrollManager;
}

export const ChatDebugHeader: React.FC<ChatDebugHeaderProps> = signalObserver(({ manager }) => {
    const mode = manager.mode.get();
    const loading = manager.loading.get();
    const metrics = manager.metrics.get();
    const currentSelection = manager.messages.currentSelection;
    const atEarliest = manager.atEarliest;
    const atLatest = manager.atLatest;

    const getStatus = (direction: 'backward' | 'forward') => {
        const isLoading = loading === direction;
        return isLoading ? <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>◐</span> : '';
    };

    const formatGap = (gap: number, trigger: number) => {
        const rounded = Math.round(gap);
        const pct = Math.round((gap / trigger) * 100);
        return `${rounded}px (${pct}%)`;
    };

    const willTrigger = (gap: number, trigger: number) => gap < trigger;

    return (
        <div className="debugHeader">
            <div className="debugRow">
                <span className="debugLabel">Query:</span>
                <span className="debugValue queryText">{currentSelection}</span>
            </div>
            <div className="debugRow">
                <span className="debugLabel">Mode:</span>
                <span className={`debugValue mode-${mode}`}>{mode}</span>
                <span className="debugLabel">Results:</span>
                <span className="debugValue">{metrics.resultCount}</span>
                <span className="debugLabel">Thresholds:</span>
                <span className="debugValue">trigger={Math.round(metrics.minBuffer)}px, anchor={Math.round(metrics.stepBack)}px</span>
            </div>
            <div className="debugRow">
                <span className="debugLabel">Buffer ↑:</span>
                <span className={`debugValue ${willTrigger(metrics.topGap, metrics.minBuffer) ? 'trigger-active' : ''}`}>
                    {formatGap(metrics.topGap, metrics.minBuffer)}
                </span>
                <span className="debugStatus">{getStatus('backward')}</span>
                <span className="debugLabel">Buffer ↓:</span>
                <span className={`debugValue ${willTrigger(metrics.bottomGap, metrics.minBuffer) ? 'trigger-active' : ''}`}>
                    {formatGap(metrics.bottomGap, metrics.minBuffer)}
                </span>
                <span className="debugStatus">{getStatus('forward')}</span>
            </div>
            <div className="debugRow">
                <span className="debugLabel">Boundaries:</span>
                <span className={`debugValue ${atEarliest ? 'boundary-hit' : ''}`}>
                    {atEarliest ? '⊣ earliest' : '← earliest'}
                </span>
                <span className={`debugValue ${atLatest ? 'boundary-hit' : ''}`}>
                    {atLatest ? 'latest ⊢' : 'latest →'}
                </span>
            </div>
        </div>
    );
});

