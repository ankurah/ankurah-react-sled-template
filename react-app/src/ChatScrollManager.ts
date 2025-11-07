import { Message, MessageView, MessageLiveQuery, ctx, JsValueMut } from "ankurah-template-wasm-bindings";

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
    private readonly minRowPx = 78;
    private readonly minBufferSize = 0.75;
    private readonly continuationStepBack = .75;
    private readonly querySize = 3.0;

    // Reactive state
    private modeMut = new JsValueMut<ScrollMode>('live');
    public readonly mode = this.modeMut.read();

    private loadingBackwardMut = new JsValueMut(false);
    public readonly loadingBackward = this.loadingBackwardMut.read();

    private loadingForwardMut = new JsValueMut(false);
    public readonly loadingForward = this.loadingForwardMut.read();

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
    private paused = false;
    private lastScrollTop: number = 0;
    private userScrolling = false;
    private hitBeginning = false; // Hit oldest messages
    private initialized = false;
    private container: HTMLDivElement | null = null;
    private scrollHandler: (() => void) | null = null;
    private wheelHandler: (() => void) | null = null;
    private touchStartHandler: (() => void) | null = null;

    constructor(private roomId: string) {
        const limit = this.computeLimit();
        this.messages = Message.query(ctx(), `room = ? ORDER BY timestamp DESC LIMIT ${limit}`, roomId);

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
            this.setLiveMode();
        } else if (this.modeMut.peek() === 'live') {
            this.scrollToBottom();
        }
    }

    destroy() {
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
        if (!this.container) return 100;
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
        const loadingFlag = isBackward ? this.loadingBackwardMut : this.loadingForwardMut;

        // Guards before setting loading flag
        if (loadingFlag.peek()) return;
        if (isBackward && this.hitBeginning) return; // Don't load backward if we've hit the beginning

        const messageList = this.items;
        if (messageList.length === 0 || !this.container) {
            await this.setLiveMode();
            return;
        }
        const anchorData = this.getContinuationAnchor(direction, messageList);
        if (!anchorData) return;

        const { el, msg } = anchorData;
        const key = `${direction}-${msg.timestamp}`;
        if (key === this.lastContinuationKey) return;

        // All guards passed - begin load
        loadingFlag.set(true);
        this.modeMut.set(direction);
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
            `room = ? AND timestamp ${op} ? ORDER BY timestamp ${order} LIMIT ${limit}`,
            this.roomId,
            Number(msg.timestamp)
        );

        // Log timestamp range after load
        const afterList = this.items;
        const earliestAfter = afterList.length > 0 ? afterList[0].timestamp : null;
        const latestAfter = afterList.length > 0 ? afterList[afterList.length - 1].timestamp : null;

        console.log('loadMore timestamps:', {
            direction,
            before: { earliest: earliestBefore, latest: latestBefore, count: beforeList.length },
            after: { earliest: earliestAfter, latest: latestAfter, count: afterList.length }
        });

        // Check if we hit the boundaries
        const resultCount = this.messages.resultset.items?.length || 0;
        if (isBackward && resultCount < limit) {
            // Hit the beginning (oldest messages)
            this.hitBeginning = true;
            console.log('→ Hit beginning (oldest messages)');
        } else if (!isBackward && resultCount < limit) {
            // Hit the end (newest messages), switch to live
            await this.setLiveMode();
            loadingFlag.set(false);
            return;
        } else if (!isBackward) {
            // Loading forward successfully - clear beginning flag
            this.hitBeginning = false;
        }

        const { y: yAfter } = offsetToParent(el) || { y: 0 };
        const delta = yAfter - yBefore;
        console.log('loadMore:', direction, msg.text, 'delta:', delta);

        this.scrollTo(this.container.scrollTop + delta);
        loadingFlag.set(false);
    }

    private checkBuffers() {
        if (!this.container) return;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const topGap = scrollTop;
        const bottomGap = scrollHeight - scrollTop - clientHeight;
        const { minBuffer } = this.getThresholds();

        console.log('checkBuffers:', { topGap, bottomGap, minBuffer });

        // If still within buffer zone, load more
        if (topGap < minBuffer) {
            this.loadMore('backward');
        } else if (bottomGap < minBuffer) {
            this.loadMore('forward');
        }
    }

    async setLiveMode() {
        console.log('→ setLiveMode');
        this.modeMut.set('live');
        this.lastContinuationKey = null;
        this.hitBeginning = false;
        this.loadingBackwardMut.set(false);
        this.loadingForwardMut.set(false);
        await this.messages.updateSelection(`room = ? ORDER BY timestamp DESC LIMIT ${this.computeLimit()}`, this.roomId);
        // afterLayout() will handle scrolling once DOM updates
    }

    private onUserScroll() {
        // Flag that the next scroll event is user-initiated
        this.userScrolling = true;
    }

    private onScroll() {
        if (!this.container) return;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const scrollDelta = scrollTop - this.lastScrollTop;
        this.lastScrollTop = scrollTop;

        const topGap = scrollTop;
        const bottomGap = scrollHeight - scrollTop - clientHeight;

        // Always update metrics (for debug display)
        this.updateMetrics();

        // Only trigger loads on user-initiated scrolls
        if (this.userScrolling) {
            this.userScrolling = false; // Clear flag

            const { minBuffer } = this.getThresholds();

            // Trigger loads based on scroll direction and buffer gaps
            if (scrollDelta < 0 && topGap < minBuffer) {
                this.loadMore('backward');
            } else if (scrollDelta > 0 && bottomGap < minBuffer) {
                this.loadMore('forward');
            }
        }
    }

    private scrollTo(scrollTop: number) {
        if (!this.container) return;
        if (scrollTop !== this.container.scrollTop) {
            this.paused = true;
            this.container.scrollTop = scrollTop;

            requestAnimationFrame(() => {
                this.updateMetrics();
                this.paused = false;
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