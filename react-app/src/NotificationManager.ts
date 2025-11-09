import { Message, MessageView, MessageLiveQuery, RoomView, RoomLiveQuery, UserView, ctx, SubscriptionGuard, JsValueMut, JsValueRead } from "{{project-name}}-wasm-bindings";

// Note: This uses one query per room since GROUP BY is not yet available in Ankurah.
// In the future, this could be optimized to a single query with GROUP BY.
export class NotificationManager {
    // @ts-expect-error TS6133: destructor is managed by FinalizationRegistry
    private _roomGuard: SubscriptionGuard;
    private roomQueries = new Map<string, { query: MessageLiveQuery; guard: SubscriptionGuard; notificationCount: number }>();
    private audioContext: AudioContext;
    private audioBuffer: AudioBuffer | null = null;
    private lastSoundPlayedAt: number = 0;
    private readonly soundDebounceMs = 300; // Don't play sounds more often than every 300ms
    private readonly volume = 0.1; // Volume level (0.0 to 1.0)
    private currentUserId: string | null;
    private activeRoomId: string | null = null; // Room currently being viewed in live mode

    private unreadCountsMut: JsValueMut<Record<string, number>>;
    public readonly unreadCounts: JsValueRead<Record<string, number>>;

    constructor(
        roomsQuery: RoomLiveQuery,
        currentUser: UserView | null
    ) {
        this.currentUserId = currentUser?.id.to_base64() || null;
        // Initialize unread counts
        [this.unreadCountsMut, this.unreadCounts] = JsValueMut.newPair<Record<string, number>>({});

        // Initialize Web Audio API
        this.audioContext = new AudioContext();
        this.loadAudioFile();

        // iOS requires user interaction to unlock audio - resume on first touch/click
        const unlockAudio = () => {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    console.log('AudioContext resumed on user interaction');
                });
            }
            // Only need to unlock once
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('click', unlockAudio);
        };

        document.addEventListener('touchstart', unlockAudio, { once: true });
        document.addEventListener('click', unlockAudio, { once: true });

        // Subscribe to room changes to manage per-room queries
        this._roomGuard = roomsQuery.subscribe((changeset) => {
            // Add queries for new rooms
            for (const room of changeset.adds) {
                this.addRoomQuery(room);
            }

            // Remove queries for removed rooms
            for (const room of changeset.removes) {
                this.removeRoomQuery(room.id.to_base64());
            }
        });
    }

    private addRoomQuery(room: RoomView) {
        const roomId = room.id.to_base64();

        if (this.roomQueries.has(roomId)) return;

        // Create lightweight query for latest messages in this room
        const query = Message.query(
            ctx(),
            `room = ? AND deleted = false ORDER BY timestamp DESC LIMIT 10`,
            roomId
        );

        const guard = query.subscribe((changeset) => {
            console.log('NotificationManager: room', room.name, 'changeset', changeset.adds.length, query.loaded);
            if (!query.loaded) return;

            const state = this.roomQueries.get(roomId)!;
            if (state.notificationCount++ === 0) return; // Skip initial load

            // After initial load, any adds from other users trigger notification
            const newMessagesFromOthers = changeset.adds.filter((msg: MessageView) => {
                const isOwnMessage = msg.user === this.currentUserId;
                console.log('NotificationManager: checking message', {
                    msgUser: msg.user,
                    currentUserId: this.currentUserId,
                    isOwnMessage,
                    text: msg.text.substring(0, 20)
                });
                return !isOwnMessage;
            });

            if (newMessagesFromOthers.length > 0) {
                console.log('NotificationManager: playing sound for', newMessagesFromOthers.length, 'messages');

                // Only increment unread count if not the active room
                const isActiveRoom = roomId === this.activeRoomId;
                if (!isActiveRoom) {
                    const counts = this.unreadCountsMut.peek();
                    this.unreadCountsMut.set({
                        ...counts,
                        [roomId]: (counts[roomId] || 0) + newMessagesFromOthers.length
                    });
                }

                // Always play sound for messages from others (even in active room)
                this.playNotificationSound();
            }
        }, false);

        this.roomQueries.set(roomId, { query, guard, notificationCount: 0 });
    }

    private removeRoomQuery(roomId: string) {
        const state = this.roomQueries.get(roomId);
        if (!state) return;

        // FinalizationRegistry will handle cleanup, but we can remove from map
        this.roomQueries.delete(roomId);

        // Remove unread count for this room
        const counts = { ...this.unreadCountsMut.peek() };
        delete counts[roomId];
        this.unreadCountsMut.set(counts);
    }

    setActiveRoom(roomId: string | null) {
        this.activeRoomId = roomId;
        if (roomId) {
            this.markAsRead(roomId);
        }
    }

    markAsRead(roomId: string) {
        const counts = this.unreadCountsMut.peek();
        if (counts[roomId]) {
            const newCounts = { ...counts };
            delete newCounts[roomId];
            this.unreadCountsMut.set(newCounts);
        }
    }

    private async loadAudioFile() {
        try {
            const response = await fetch('/sounds/notification.mp3');
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            console.log('Notification sound loaded successfully');
        } catch (error) {
            console.error('Failed to load notification sound:', error);
        }
    }

    private playNotificationSound() {
        const now = Date.now();

        // Debounce: don't play if we just played recently
        if (now - this.lastSoundPlayedAt < this.soundDebounceMs) {
            return;
        }

        if (!this.audioBuffer) {
            console.log('Audio buffer not loaded yet');
            return;
        }

        this.lastSoundPlayedAt = now;

        try {
            // Resume audio context if suspended (iOS requirement)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            // Create a new buffer source for this playback
            const source = this.audioContext.createBufferSource();
            source.buffer = this.audioBuffer;

            // Create gain node for volume control
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = this.volume;

            // Connect: source -> gain -> destination
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            // Play the sound
            source.start(0);
        } catch (error) {
            console.error('Failed to play notification sound:', error);
        }
    }
}

