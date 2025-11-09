import { useMemo, useState } from "react";
import { ws_client, JsValueRead, UserView } from "{{project-name}}-wasm-bindings";
import { signalObserver } from "../utils";
import { EditableTextField } from "./EditableTextField";
import { QRCodeModal } from "./QRCodeModal";
import "./Header.css";

interface HeaderProps {
    currentUser: JsValueRead<UserView | null>;
}

export const Header: React.FC<HeaderProps> = signalObserver(({ currentUser }) => {
    const connectionState = useMemo(() => ws_client().connection_state, []);
    const connectionStatus = connectionState.value.value();
    const user = currentUser.get();
    const [showQRCode, setShowQRCode] = useState(false);

    const currentUrl = window.location.href;

    return (
        <>
            <div className="header">
                <h1 className="title">{{project-name}} Chat</h1>
                <div className="headerRight">
                    <button
                        className="qrButton"
                        onClick={() => setShowQRCode(true)}
                        title="Show QR Code"
                    >
                        📱
                    </button>
                    <div className="userInfo">
                        <span>👤</span>
                        {user ?
                            <EditableTextField view={user} field="display_name" className="userName" />
                            :
                            <span className="userName">Loading...</span>
                        }
                    </div>
                    <div className={`connectionStatus ${connectionStatus === "Connected" ? 'connected' : 'disconnected'}`}>
                        {connectionStatus || "Disconnected"}
                    </div>
                </div>
            </div>
            {showQRCode && (
                <QRCodeModal
                    url={currentUrl}
                    onClose={() => setShowQRCode(false)}
                />
            )}
        </>
    );
});

