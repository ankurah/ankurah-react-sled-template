import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { MessageView, JsValueMut, ctx } from "{{project-name}}-wasm-bindings";
import "./MessageContextMenu.css";

interface MessageContextMenuProps {
    x: number;
    y: number;
    message: MessageView;
    editingMessageMut: JsValueMut<MessageView | null>;
    onClose: () => void;
}

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
    x,
    y,
    message,
    editingMessageMut,
    onClose,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ x, y });

    const handleEdit = () => {
        editingMessageMut.set(message);
        onClose();
    };

    const handleDelete = async () => {
        try {
            const trx = ctx().begin();
            const mutable = message.edit(trx);
            mutable.deleted.set(true);
            await trx.commit();
            console.log("Message deleted");
        } catch (error) {
            console.error("Failed to delete message:", error);
        }
        onClose();
    };

    // Adjust position to prevent menu from going off-screen
    useLayoutEffect(() => {
        if (menuRef.current) {
            const menuRect = menuRef.current.getBoundingClientRect();
            let adjustedX = x;
            let adjustedY = y;

            // Check right edge
            if (x + menuRect.width > window.innerWidth) {
                adjustedX = window.innerWidth - menuRect.width - 10;
            }

            // Check bottom edge
            if (y + menuRect.height > window.innerHeight) {
                adjustedY = window.innerHeight - menuRect.height - 10;
            }

            // Check left edge
            if (adjustedX < 10) {
                adjustedX = 10;
            }

            // Check top edge
            if (adjustedY < 10) {
                adjustedY = 10;
            }

            setPosition({ x: adjustedX, y: adjustedY });
        }
    }, [x, y]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="contextMenu"
            style={% raw %}{{position: "fixed", left: `${position.x}px`, top: `${position.y}px`}}{% endraw %}
        >
            <button
                className="contextMenuItem"
                onClick={handleEdit}
            >
                Edit
            </button>
            <button
                className="contextMenuItem contextMenuItemDanger"
                onClick={handleDelete}
            >
                Delete
            </button>
        </div>
    );
};

