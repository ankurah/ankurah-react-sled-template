import { QRCodeSVG } from "qrcode.react";
import "./QRCodeModal.css";

interface QRCodeModalProps {
    url: string;
    onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ url, onClose }) => {
    return (
        <div className="qrModalOverlay" onClick={onClose}>
            <div className="qrModalContent" onClick={(e) => e.stopPropagation()}>
                <div className="qrModalHeader">
                    <h2>Scan to Connect to {{project-name}} Chat</h2>
                    <button className="qrCloseButton" onClick={onClose}>×</button>
                </div>
                <div className="qrCodeContainer">
                    <QRCodeSVG
                        value={url}
                        size={256}
                        level="M"
                        includeMargin={true}
                    />
                </div>
                <div className="qrUrlDisplay">
                    <code>{url}</code>
                </div>
                <p className="qrInstructions">
                    Scan this QR code with your mobile device to open the app
                </p>
            </div>
        </div>
    );
};

