import { useMemo, useState, useEffect } from "react";
import {
    Room,
    RoomView,
    ctx,
    JsValueMut,
} from "{{project-name}}-wasm-bindings";
import { signalObserver } from "../utils";
import "./RoomList.css";


interface RoomListProps {
    selectedRoom: JsValueMut<RoomView | null>;
}

export const RoomList: React.FC<RoomListProps> = signalObserver(({ selectedRoom }) => {
    const [isCreating, setIsCreating] = useState(false);

    const rooms = useMemo(() => Room.query(ctx(), "true ORDER BY name ASC"), []);
    const currentRoom = selectedRoom.get();
    const selectedRoomId = currentRoom?.id.to_base64();
    const items = (rooms.resultset.items || []) as RoomView[];

    // Auto-select room from URL or default to "General"
    if (!currentRoom && items.length > 0) {
        const roomId = new URLSearchParams(window.location.search).get('room');
        const roomToSelect = (roomId && items.find(r => r.id.to_base64() === roomId))
            || items.find(r => r.name === "General");

        if (roomToSelect) selectedRoom.set(roomToSelect);
    }

    // Update URL when room changes
    useEffect(() => {
        selectedRoom.subscribe((room: RoomView | null) => {
            if (!room) return;
            const url = new URL(window.location.href);
            url.searchParams.set('room', room.id.to_base64());
            window.history.replaceState({}, '', url.toString());
        });
    }, [selectedRoom]);

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
                    items.map((room) => (
                        <div
                            key={room.id.to_base64()}
                            className={`roomItem ${selectedRoomId === room.id.to_base64() ? 'selected' : ''}`}
                            onClick={() => selectedRoom.set(room)}
                        >
                            # {room.name}
                        </div>
                    ))
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