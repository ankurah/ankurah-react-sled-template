import { useState } from "react";

/**
 * Manages debug mode visibility with URL parameter and localStorage persistence.
 * - URL param `?debug=true|1` enables debug mode
 * - URL param `?debug=false|0` disables debug mode  
 * - State persists in localStorage between sessions
 */
export function useDebugMode() {
    const [showDebug, setShowDebug] = useState(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const urlDebug = urlParams.get('debug');
        if (urlDebug !== null) {
            const debugValue = urlDebug === 'true' || urlDebug === '1';
            localStorage.setItem('chatDebugVisible', String(debugValue));
            return debugValue;
        }
        return localStorage.getItem('chatDebugVisible') === 'true';
    });

    const toggleDebug = () => {
        setShowDebug(prev => {
            const newValue = !prev;
            localStorage.setItem('chatDebugVisible', String(newValue));
            return newValue;
        });
    };

    return { showDebug, toggleDebug };
}

