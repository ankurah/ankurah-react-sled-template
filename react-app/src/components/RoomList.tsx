import { useState, useEffect } from "react";
import {
    Room,
    RoomView,
    RoomLiveQuery,
    ctx,
    JsValueMut,
} from "{{project-name}}-wasm-bindings";
import { signalObserver } from "../utils";
import { NotificationManager } from "../NotificationManager";
import "./RoomList.css";


interface RoomListProps {
    selectedRoom: JsValueMut<RoomView | null>;
    rooms: RoomLiveQuery;
    notificationManager: NotificationManager | null;
}

export const RoomList: React.FC<RoomListProps> = signalObserver(({ selectedRoom, rooms, notificationManager }) => {
    const [isCreating, setIsCreating] = useState(false);

    // Each of these is a signal, so merely accessing it inside the signalObserver will track it
    const items = rooms.items;
    const unreadCounts = notificationManager?.unreadCounts.get() || {};
    const currentRoom = selectedRoom.get();

    // Auto-select room from URL or default to "General"
    useEffect(() => {
        if (!currentRoom && items.length > 0) {
            const roomId = new URLSearchParams(window.location.search).get('room');
            const roomToSelect = (roomId && items.find(r => r.id.to_base64() === roomId))
                || items.find(r => r.name === "General");

            if (roomToSelect) selectedRoom.set(roomToSelect);
        }
    }, [currentRoom, items, selectedRoom]);

    // Update URL when room changes
    useEffect(() => {
        if (!currentRoom) return;
        const url = new URL(window.location.href);
        url.searchParams.set('room', currentRoom.id.to_base64());
        window.history.replaceState({}, '', url.toString());
    }, [currentRoom]);

    return (
        <div className="sidebar">
            <div className="sidebarHeader">
                <span>Rooms</span>
                <button
                    className="createRoomButton"
                    onClick={() => setIsCreating(true)}
                    title="Create new room"
                >
                    +
                </button>
            </div>

            <div className="roomList">
                {isCreating && (
                    <NewRoomInput
                        selectedRoom={selectedRoom}
                        onCancel={() => setIsCreating(false)}
                    />
                )}

                {items.length === 0 ? (
                    <div className="emptyRooms">No rooms available</div>
                ) : (
                    items.map((room) => {
                        const roomId = room.id.to_base64();
                        const unreadCount = unreadCounts[roomId] || 0;
                        return (
                            <div
                                key={roomId}
                                className={`roomItem ${currentRoom?.id.to_base64() === roomId ? 'selected' : ''}`}
                                onClick={() => selectedRoom.set(room)}
                            >
                                # {room.name}
                                {unreadCount > 0 && (
                                    <span className="unreadBadge">
                                        {unreadCount >= 10 ? '10+' : unreadCount}
                                    </span>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
});



interface NewRoomInputProps {
    selectedRoom: JsValueMut<RoomView | null>;
    onCancel: () => void;
}

const NewRoomInput: React.FC<NewRoomInputProps> = ({ selectedRoom, onCancel }) => {
    const [roomName, setRoomName] = useState("");

    const handleCreate = async () => {
        if (!roomName.trim()) return;

        try {
            const transaction = ctx().begin();
            const room = await Room.create(transaction, {
                name: roomName.trim(),
            });
            await transaction.commit();

            selectedRoom.set(room);
            onCancel();
        } catch (error) {
            console.error("Failed to create room:", error);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleCreate();
        } else if (e.key === "Escape") {
            onCancel();
        }
    };

    return (
        <div className="createRoomInput">
            <input
                type="text"
                placeholder="Room name..."
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={handleKeyPress}
                onBlur={() => !roomName.trim() && onCancel()}
                autoFocus
            />
        </div>
    );
};