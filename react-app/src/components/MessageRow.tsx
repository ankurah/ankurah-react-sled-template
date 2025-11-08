import { useMemo, useState } from "react";
import {
  MessageView,
  UserView,
  UserLiveQuery,
  JsValueMut,
} from "ankurah-template-wasm-bindings";
import { signalObserver } from "../utils";
import { MessageContextMenu } from "./MessageContextMenu";
import "./MessageRow.css";

interface MessageRowProps {
  message: MessageView;
  users: UserLiveQuery;
  currentUserId: string | null;
  editingMessage: MessageView | null;
  editingMessageMut: JsValueMut<MessageView | null>;
}

export const MessageRow: React.FC<MessageRowProps> = signalObserver(({ message, users, currentUserId, editingMessage, editingMessageMut }) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const author = useMemo(() => {
    const userList = (users.resultset.items || []) as UserView[];
    return userList.find(u => u.id.to_base64() === message.user);
  }, [users.resultset.items, message.user]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (currentUserId && message.user === currentUserId) {
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  };

  const isEditing = editingMessage && message.id.to_base64() === editingMessage.id.to_base64();
  const isOwnMessage = currentUserId && message.user === currentUserId;

  return (
    <div
      className={`messageBubble ${isEditing ? 'editing' : ''} ${isOwnMessage ? 'ownMessage' : ''}`}
      data-msg-id={message.id.to_base64()}
      onContextMenu={handleContextMenu}
    >
      {!isOwnMessage && (
        <div className="messageHeader">
          <span className="messageAuthor">{author?.display_name || "Unknown"}</span>
        </div>
      )}
      <div className="messageText">{message.text}</div>
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          message={message}
          editingMessageMut={editingMessageMut}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});
