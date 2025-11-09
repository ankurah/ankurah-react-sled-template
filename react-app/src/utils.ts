import { useState, useEffect } from "react";
import { useObserve, User, ctx, EntityId, UserView, JsValueMut, JsValueRead } from "{{project-name}}-wasm-bindings";

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

// LocalStorage keys
const STORAGE_KEY_USER_ID = "{{crate_name}}_user_id";

export function ensureUser(): JsValueRead<UserView | null> {
    const [userMut, userRead] = JsValueMut.newPair<UserView | null>(null);

    const initUser = async () => {
        try {
            const context = ctx();
            const storedUserId = localStorage.getItem(STORAGE_KEY_USER_ID);

            if (storedUserId) {
                const user = await User.get(context, EntityId.from_base64(storedUserId));
                userMut.set(user);
                return;
            }

            const transaction = context.begin();
            const userView = await User.create(transaction, {
                display_name: `User-${Math.floor(Math.random() * 10000)}`,
            });
            await transaction.commit();
            localStorage.setItem(STORAGE_KEY_USER_ID, userView.id.to_base64());

            userMut.set(userView);
        } catch (error) {
            console.error("Failed to initialize user:", error);
        }
    };

    initUser();
    return userRead;
}
