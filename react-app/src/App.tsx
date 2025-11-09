import { useMemo } from "react";
import {
  Room,
  RoomView,
  JsValueMut,
  ctx,
} from "{{project-name}}-wasm-bindings";
import { Header } from "./components/Header";
import { Chat } from "./components/Chat";
import { RoomList } from "./components/RoomList";
import { DebugOverlay } from "./components/DebugOverlay";
import { NotificationManager } from "./NotificationManager";
import { signalObserver, ensureUser } from "./utils";
import "./App.css";

const App: React.FC = signalObserver(() => {
  const currentUser = useMemo(() => ensureUser(), []);
  const [selectedRoom, selectedRoomRead] = useMemo(() => JsValueMut.newPair<RoomView | null>(null), []);

  const rooms = useMemo(() => Room.query(ctx(), "true ORDER BY name ASC"), []);
  const user = currentUser.get();
  const notificationManager = useMemo(() => {
    if (!user) return null;
    return new NotificationManager(rooms, user);
  }, [rooms, user]);

  return (
    <>
      <DebugOverlay />

      <div className="container">
        <Header currentUser={currentUser} />

        <div className="mainContent">
          <RoomList
            selectedRoom={selectedRoom}
            rooms={rooms}
            notificationManager={notificationManager}
          />
          <Chat
            room={selectedRoomRead}
            currentUser={currentUser}
            notificationManager={notificationManager}
          />
        </div>
      </div>
    </>
  );
});

export default App;