import { useMemo } from "react";
import {
  RoomView,
  JsValueMut,
} from "{{project-name}}-wasm-bindings";
import { Header } from "./components/Header";
import { Chat } from "./components/Chat";
import { RoomList } from "./components/RoomList";
import { DebugOverlay } from "./components/DebugOverlay";
import { signalObserver, ensureUser } from "./utils";
import "./App.css";

const App: React.FC = signalObserver(() => {
  const currentUser = useMemo(() => ensureUser(), []);
  const [selectedRoom, selectedRoomRead] = useMemo(() => JsValueMut.newPair<RoomView | null>(null), []);

  return (
    <>
      <DebugOverlay />

      <div className="container">
        <Header currentUser={currentUser} />

        <div className="mainContent">
          <RoomList selectedRoom={selectedRoom} />
          <Chat room={selectedRoomRead} currentUser={currentUser} />
        </div>
      </div>
    </>
  );
});

export default App;