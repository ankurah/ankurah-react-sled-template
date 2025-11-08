import { useEffect, useRef } from "react";
import { MessageView, JsValueMut, ctx } from "ankurah-template-wasm-bindings";
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
            style={{
                position: "fixed",
                left: `${x}px`,
                top: `${y}px`,
            }}
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

