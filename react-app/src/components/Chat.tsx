import { useMemo, useEffect } from "react";
import {
    User,
    ctx,
    JsValueRead,
    JsValueMut,
    RoomView,
    UserView,
    MessageView,
} from "{{project-name}}-wasm-bindings";
import { MessageRow } from "./MessageRow";
import { MessageInput } from "./MessageInput";
import { ChatDebugHeader } from "./ChatDebugHeader";
import { signalObserver } from "../utils";
import { ChatScrollManager } from "../ChatScrollManager";
import { NotificationManager } from "../NotificationManager";
import { useDebugMode } from "../hooks/useDebugMode";
import "./Chat.css";

interface ChatProps {
    room: JsValueRead<RoomView | null>;
    currentUser: JsValueRead<UserView | null>;
    notificationManager: NotificationManager | null;
}

export const Chat: React.FC<ChatProps> = signalObserver(({ room, currentUser, notificationManager }) => {
    const currentRoom = room.get();
    const user = currentUser.get();

    const { showDebug, toggleDebug } = useDebugMode();

    // State for editing messages
    const editingMessageMut = useMemo(() => new JsValueMut<MessageView | null>(null), []);
    const editingMessage = editingMessageMut.get();

    // Create scroll manager when room changes
    const manager = useMemo(() => {
        if (!currentRoom || !notificationManager) return null;
        return new ChatScrollManager(currentRoom.id.to_base64(), notificationManager);
    }, [currentRoom, notificationManager]);

    // Query for all users
    const users = useMemo(() => User.query(ctx(), ""), []);

    // Access messages directly for observer tracking
    const messageList = manager?.items || [];
    const showJumpToCurrent = manager ? !manager.shouldAutoScroll : false;
    const currentUserId = user?.id.to_base64() || null;

    // Cleanup on unmount or room change
    useEffect(() => () => manager?.destroy(), [manager]);

    if (!currentRoom) {
        return (
            <div className="chatContainer">
                <div className="emptyState">Select a room to start chatting</div>
            </div>
        );
    }

    return (
        <div className="chatContainer">
            {manager && showDebug && <ChatDebugHeader manager={manager} />}

            {manager && (
                <button
                    className="debugToggle"
                    onClick={toggleDebug}
                    title={showDebug ? "Hide debug info" : "Show debug info"}
                    style={% raw %}{{opacity: 0.35}}{% endraw %}
                >
                    {showDebug ? "▼" : "▲"}
                </button>
            )}

            <div className="messagesContainer" ref={manager?.bindContainer}>
                {messageList.length === 0 ? (
                    <div className="emptyState">No messages yet. Be the first to say hello!</div>
                ) : (
                    messageList.map((message) => (
                        <MessageRow
                            key={message.id.toString()}
                            message={message}
                            users={users}
                            currentUserId={currentUserId}
                            editingMessage={editingMessage}
                            editingMessageMut={editingMessageMut}
                        />
                    ))
                )}
            </div>

            {showJumpToCurrent && (
                <button
                    className="jumpToCurrent"
                    onClick={() => manager?.jumpToLive()}
                >
                    Jump to Current ↓
                </button>
            )}

            <MessageInput
                room={currentRoom}
                currentUser={user}
                editingMessageMut={editingMessageMut}
                manager={manager}
            />
        </div>
    );
});
