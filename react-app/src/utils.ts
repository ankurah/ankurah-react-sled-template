import { useState, useEffect } from "react";
import { useObserve, User, ctx, EntityId, UserView, JsValueMut, JsValueRead } from "ankurah-template-wasm-bindings";

export function signalObserver<T>(fc: React.FC<T>): React.FC<T> {
    return (props: T) => {
        const observer = useObserve();
        try {
            return fc(props);
        } finally {
            observer.finish();
        }
    };
}

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): T | null {
    const [value, setValue] = useState<T | null>(null);
    useEffect(() => {
        fn().then(setValue);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
}

// User initialization is now handled in WASM (wasm-bindings/src/lib.rs)
// Re-export the current_user signal
export { current_user as currentUser } from "ankurah-template-wasm-bindings";
