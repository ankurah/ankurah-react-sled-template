import { Message, MessageView, MessageLiveQuery, ctx, JsValueMut, SubscriptionGuard } from "{{project-name}}-wasm-bindings";
import { NotificationManager } from "./NotificationManager";

type ScrollMode = 'live' | 'backward' | 'forward';

interface ScrollMetrics {
    topGap: number;
    bottomGap: number;
    minBuffer: number;
    stepBack: number;
    resultCount: number;
}

export class ChatScrollManager {
    // Configuration (in fractional screen height units)
    private readonly minRowPx = 74;
    private readonly minBufferSize = 0.75;  // Trigger threshold: load when within 0.75 viewports of edge
    private readonly continuationStepBack = .75;
    private readonly querySize = 3.0;       // Load 3.0 viewports worth of content

    // Safety margin: querySize / minBufferSize = 3.0 / 0.75 = 4.0
    // This means we load 4x as much content as the trigger threshold.
    // Even if a loadMore returns zero ADDITIONAL records (resultCount == limit but all overlap),
    // we still have (querySize - minBufferSize) = 2.25 viewports of buffer remaining,
    // which is 3x the trigger threshold - plenty of cushion to avoid gaps.

    // Reactive state
    private modeMut = new JsValueMut<ScrollMode>('live');
    public readonly mode = this.modeMut.read();

    private loadingMut = new JsValueMut<'forward' | 'backward' | false>(false);
    public readonly loading = this.loadingMut.read();

    private metricsMut = new JsValueMut<ScrollMetrics>({
        topGap: 0,
        bottomGap: 0,
        minBuffer: 0,
        stepBack: 0,
        resultCount: 0
    });
    public readonly metrics = this.metricsMut.read();
    public readonly messages: MessageLiveQuery;
    private lastContinuationKey: string | null = null;
    private lastScrollTop: number = 0;
    private userScrolling = false;
    private initialized = false;
    private container: HTMLDivElement | null = null;
    private scrollHandler: (() => void) | null = null;
    private wheelHandler: (() => void) | null = null;
    private touchStartHandler: (() => void) | null = null;

    // Track the actual query parameters used (reactive for boundary detection)
    private currentLimitMut = new JsValueMut<number>(0);
    private currentDirectionMut = new JsValueMut<'ASC' | 'DESC'>('DESC');
    private _guard: SubscriptionGuard | null = null;

    constructor(
        private roomId: string,
        private notificationManager: NotificationManager
    ) {
        const limit = this.computeLimit();
        this.currentLimitMut.set(limit);
        this.currentDirectionMut.set('DESC');
        this.messages = Message.query(ctx(), ...this.liveModeSelection(limit));

        // Subscribe to message changes
        this._guard = this.messages.subscribe(() => {
            // we seem to be getting called before the observer, which figures,
            // because we're registering the subscription before the observer does
            setTimeout(() => this.afterLayout(), 0);
        });

        // Set as active room since rooms start in live mode
        this.notificationManager.setActiveRoom(this.roomId);
    }

    private liveModeSelection(limit: number): [string, string] {
        return [`room = ? AND deleted = false ORDER BY timestamp DESC LIMIT ${limit}`, this.roomId];
    }

    async setLiveMode() {
        console.log('→ setLiveMode');
        this.modeMut.set('live');
        this.lastContinuationKey = null;
        this.loadingMut.set(false);
        const limit = this.computeLimit();
        this.currentLimitMut.set(limit);
        this.currentDirectionMut.set('DESC');
        await this.messages.updateSelection(...this.liveModeSelection(limit));
        // Set as active room when entering live mode
        this.notificationManager.setActiveRoom(this.roomId);
        // afterLayout() will handle scrolling on next render
    }

    // Called explicitly when user clicks "Jump to Current"
    async jumpToLive() {
        console.log('jumpToLive');
        await this.setLiveMode();
        this.scrollToBottom();
    }

    // Boundary detection
    get atEarliest(): boolean {
        const resultCount = this.messages.resultset.items?.length || 0;
        const currentLimit = this.currentLimitMut.get();
        const currentDirection = this.currentDirectionMut.get();
        // DESC queries hit oldest when count < limit
        // Note: If resultCount == limit, we might actually be at the earliest, but we can't know
        // until we try to load more. However, our safety margin (querySize - minBufferSize = 2.25
        // viewports) ensures we won't have a visible gap even if the next load returns zero new records.
        return currentDirection === 'DESC' && resultCount < currentLimit;
    }

    get atLatest(): boolean {
        const mode = this.modeMut.peek();
        const resultCount = this.messages.resultset.items?.length || 0;
        const currentLimit = this.currentLimitMut.get();
        const currentDirection = this.currentDirectionMut.get();
        // Live mode is always at latest, ASC queries hit newest when count < limit
        return mode === 'live' || (currentDirection === 'ASC' && resultCount < currentLimit);
    }

    // Buffer gap detection
    private get topBelowMinimum(): boolean {
        if (!this.container) return false;
        const { minBuffer } = this.getThresholds();
        return this.container.scrollTop < minBuffer;
    }

    private get bottomBelowMinimum(): boolean {
        if (!this.container) return false;
        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const bottomGap = scrollHeight - scrollTop - clientHeight;
        const { minBuffer } = this.getThresholds();
        return bottomGap < minBuffer;
    }

    get shouldAutoScroll(): boolean {
        const mode = this.mode.get();
        const bottomGap = this.metrics.get().bottomGap;
        return mode === 'live' && bottomGap < 50;
    }

    get items(): MessageView[] {
        const raw = (this.messages.resultset.items || []) as MessageView[];
        // live and backward modes use DESC → reverse for display
        // forward mode uses ASC → no reverse
        return this.modeMut.peek() !== 'forward' ? [...raw].reverse() : raw;
    }

    bindContainer = (container: HTMLDivElement | null) => {
        if (this.container === container) return;

        if (this.container) {
            if (this.scrollHandler) {
                this.container.removeEventListener('scroll', this.scrollHandler);
            }
            if (this.wheelHandler) {
                this.container.removeEventListener('wheel', this.wheelHandler);
            }
            if (this.touchStartHandler) {
                this.container.removeEventListener('touchstart', this.touchStartHandler);
            }
        }

        this.container = container;

        if (container) {
            this.lastScrollTop = container.scrollTop;

            this.scrollHandler = () => this.onScroll();
            this.wheelHandler = () => this.onUserScroll();
            this.touchStartHandler = () => this.onUserScroll();

            container.addEventListener('scroll', this.scrollHandler, { passive: true });
            container.addEventListener('wheel', this.wheelHandler, { passive: true });
            container.addEventListener('touchstart', this.touchStartHandler, { passive: true });
        } else {
            this.scrollHandler = null;
            this.wheelHandler = null;
            this.touchStartHandler = null;
        }
    };
    afterLayout() {
        if (!this.initialized) {
            this.initialized = true;
        }
        if (this.shouldAutoScroll) {
            this.scrollToBottom();
        }
    }

    destroy() {
        this._guard?.free();
        if (this.container) {
            if (this.scrollHandler) {
                this.container.removeEventListener('scroll', this.scrollHandler);
            }
            if (this.wheelHandler) {
                this.container.removeEventListener('wheel', this.wheelHandler);
            }
            if (this.touchStartHandler) {
                this.container.removeEventListener('touchstart', this.touchStartHandler);
            }
        }
        this.container = null;
        this.scrollHandler = null;
        this.wheelHandler = null;
        this.touchStartHandler = null;
    }

    private computeLimit(): number {
        if (!this.container) return 100; // TODO set back to 20 and investigate missing records after some updateSelection calls
        const computedStyle = window.getComputedStyle(this.container);
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
        const contentHeight = this.container.clientHeight - paddingTop - paddingBottom;
        const queryHeightPx = contentHeight * this.querySize;
        return Math.ceil(queryHeightPx / this.minRowPx);
    }

    private getThresholds(): { minBuffer: number; stepBack: number } {
        if (!this.container) return { minBuffer: 150, stepBack: 240 };
        const windowPx = this.container.clientHeight;
        return {
            minBuffer: this.minBufferSize * windowPx,
            stepBack: this.continuationStepBack * windowPx
        };
    }

    private updateMetrics() {
        if (!this.container) return;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const { minBuffer, stepBack } = this.getThresholds();

        this.metricsMut.set({
            topGap: scrollTop,
            bottomGap: scrollHeight - scrollTop - clientHeight,
            minBuffer,
            stepBack,
            resultCount: this.messages.resultset.items?.length || 0
        });
    }

    // Get continuation anchor: stepBack distance past opposite edge
    // For backward: pick message stepBack BELOW bottom of viewport
    // For forward: pick message stepBack ABOVE top of viewport
    private getContinuationAnchor(direction: 'backward' | 'forward', messageList: MessageView[]): { el: HTMLElement; msg: MessageView } | null {
        if (!this.container || messageList.length === 0) return null;

        const { stepBack } = this.getThresholds();
        const isBackward = direction === 'backward';

        if (isBackward) {
            // Step back from bottom of newest message
            const startEl = this.container.querySelector(`[data-msg-id="${messageList[messageList.length - 1].id.to_base64()}"]`) as HTMLElement;
            if (!startEl) return null;
            const targetPos = startEl.offsetTop + startEl.offsetHeight - stepBack;

            for (let i = messageList.length - 1; i >= 0; i--) {
                const msg = messageList[i];
                const el = this.container.querySelector(`[data-msg-id="${msg.id.to_base64()}"]`) as HTMLElement;
                if (!el) continue;

                if (el.offsetTop + el.offsetHeight <= targetPos) {
                    console.log('getContinuationAnchor backward:', { index: i, total: messageList.length, timestamp: msg.timestamp });
                    return { el, msg };
                }
            }
            // Fallback: return oldest message if nothing found
            const msg = messageList[0];
            const el = this.container.querySelector(`[data-msg-id="${msg.id.to_base64()}"]`) as HTMLElement;
            if (el) {
                console.log('getContinuationAnchor backward (fallback to oldest):', { index: 0, total: messageList.length });
                return { el, msg };
            }
        } else {
            // Step forward from top of oldest message
            const startEl = this.container.querySelector(`[data-msg-id="${messageList[0].id.to_base64()}"]`) as HTMLElement;
            if (!startEl) return null;
            const targetPos = startEl.offsetTop + stepBack;

            for (let i = 0; i < messageList.length; i++) {
                const msg = messageList[i];
                const el = this.container.querySelector(`[data-msg-id="${msg.id.to_base64()}"]`) as HTMLElement;
                if (!el) continue;

                if (el.offsetTop >= targetPos) {
                    console.log('getContinuationAnchor forward:', { index: i, total: messageList.length, timestamp: msg.timestamp });
                    return { el, msg };
                }
            }
            // Fallback: return newest message if nothing found
            const msg = messageList[messageList.length - 1];
            const el = this.container.querySelector(`[data-msg-id="${msg.id.to_base64()}"]`) as HTMLElement;
            if (el) {
                console.log('getContinuationAnchor forward (fallback to newest):', { index: messageList.length - 1, total: messageList.length });
                return { el, msg };
            }
        }
        return null;
    }

    async loadMore(direction: 'backward' | 'forward') {
        const isBackward = direction === 'backward';
        const messageList = this.items;

        const anchorData = this.getContinuationAnchor(direction, messageList);
        if (!anchorData) return;

        const { el, msg } = anchorData;
        const key = `${direction}-${msg.timestamp}`;
        if (key === this.lastContinuationKey) return;

        // Begin load
        this.loadingMut.set(direction);
        this.modeMut.set(direction);
        // Clear active room when leaving live mode
        if (this.modeMut.peek() !== 'live') {
            this.notificationManager.setActiveRoom(null);
        }
        this.lastContinuationKey = key;

        const limit = this.computeLimit();
        const { y: yBefore } = offsetToParent(el) || { y: 0 };

        // Log timestamp range before load
        const beforeList = this.items;
        const earliestBefore = beforeList.length > 0 ? beforeList[0].timestamp : null;
        const latestBefore = beforeList.length > 0 ? beforeList[beforeList.length - 1].timestamp : null;

        const op = isBackward ? '<=' : '>=';
        const order = isBackward ? 'DESC' : 'ASC';

        await this.messages.updateSelection(
            `room = ? AND deleted = false AND timestamp ${op} ? ORDER BY timestamp ${order} LIMIT ${limit}`,
            this.roomId,
            Number(msg.timestamp)
        );
        this.currentLimitMut.set(limit);
        this.currentDirectionMut.set(order);

        // Log timestamp range after load
        const afterList = this.items;
        const earliestAfter = afterList.length > 0 ? afterList[0].timestamp : null;
        const latestAfter = afterList.length > 0 ? afterList[afterList.length - 1].timestamp : null;

        console.log('loadMore timestamps:', {
            direction,
            before: { earliest: earliestBefore, latest: latestBefore, count: beforeList.length },
            after: { earliest: earliestAfter, latest: latestAfter, count: afterList.length }
        });

        // If we hit the newest boundary - switch to live
        if (this.atLatest) {
            await this.setLiveMode();
            return;
        }

        const { y: yAfter } = offsetToParent(el) || { y: 0 };
        const delta = yAfter - yBefore;
        console.log('loadMore:', direction, msg.text, 'delta:', delta);

        if (this.container) this.scrollTo(this.container.scrollTop + delta);
        this.loadingMut.set(false);
    }

    private onUserScroll() {
        // Flag that the next scroll event is user-initiated
        this.userScrolling = true;
    }

    private onScroll() {
        if (!this.container) return;

        const scrollDelta = this.container.scrollTop - this.lastScrollTop;
        this.lastScrollTop = this.container.scrollTop;

        // Always update metrics (for debug display)
        this.updateMetrics();

        // Only trigger loads on user-initiated scrolls
        if (this.userScrolling) {
            this.userScrolling = false;

            const messageList = this.items;
            if (messageList.length === 0) return;

            // Scrolled up - try to load older messages
            if (scrollDelta < 0 && this.topBelowMinimum && !this.atEarliest && this.loadingMut.peek() !== 'backward') {
                this.loadMore('backward');
            }
            // Scrolled down - try to load newer messages
            else if (scrollDelta > 0 && this.bottomBelowMinimum && !this.atLatest && this.loadingMut.peek() !== 'forward') {
                this.loadMore('forward');
            }
        }
    }

    private scrollTo(scrollTop: number) {
        if (!this.container) return;
        if (scrollTop !== this.container.scrollTop) {
            this.container.scrollTop = scrollTop;
            requestAnimationFrame(() => {
                this.updateMetrics();
            });
        }
    }

    scrollToBottom() {
        if (!this.container) return;
        this.scrollTo(this.container.scrollHeight);
    }
}

function offsetToParent(el: HTMLElement): { x: number, y: number } | null {
    const a = el.getBoundingClientRect();
    const b = el.parentElement?.getBoundingClientRect()
    if (!b) return null;
    return { x: a.left - b.left, y: a.top - b.top };
}