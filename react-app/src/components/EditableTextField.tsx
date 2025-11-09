import { useState, useRef, useEffect } from "react";
import { ctx, Transaction, YrsStringString } from "{{project-name}}-wasm-bindings";
import { signalObserver } from "../utils";
import "./EditableTextField.css";

interface Props<T, K extends keyof T & string> {
    view: T & {
        [P in K]: string;
    } & {
        edit(trx: Transaction): Record<K, YrsStringString>
    };
    field: K;
    placeholder?: string;
    className?: string;
}

export const EditableTextField = signalObserver(<T, K extends keyof T & string>({
    view,
    field,
    placeholder = "Click to edit",
    className = ""
}: Props<T, K>) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState("");
    const [cursorPos, setCursorPos] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const lastValueRef = useRef("");

    const currentValue = view[field] || "";

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(cursorPos, cursorPos);
        }
    }, [isEditing, cursorPos]);

    const startEdit = () => {
        if (!view) return;
        const value = String(currentValue);
        setLocalValue(value);
        lastValueRef.current = value;
        setCursorPos(value.length);
        setIsEditing(true);
    };

    const applyChanges = (oldValue: string, newValue: string) => {
        const trx = ctx().begin();
        const fieldWrapper = view.edit(trx)[field];

        // Find where strings differ
        let i = 0;
        const minLen = Math.min(oldValue.length, newValue.length);
        while (i < minLen && oldValue[i] === newValue[i]) i++;

        // Delete remainder of old, insert remainder of new
        const deleteCount = oldValue.length - i;
        if (deleteCount > 0) fieldWrapper.delete(i, deleteCount);

        const insertText = newValue.slice(i);
        if (insertText) fieldWrapper.insert(i, insertText);

        trx.commit();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        const newCursorPos = e.target.selectionStart || 0;

        applyChanges(lastValueRef.current, newValue);

        setLocalValue(newValue);
        lastValueRef.current = newValue;
        setCursorPos(newCursorPos);
    };

    const endEdit = () => {
        setIsEditing(false);
        setLocalValue("");
        lastValueRef.current = "";
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            endEdit();
        }
    };

    return isEditing ? (
        <input
            ref={inputRef}
            type="text"
            className={`editableInput ${className}`}
            value={localValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={endEdit}
        />
    ) : (
        <span className={`editableText ${className}`} onClick={startEdit} title={placeholder}>
            {currentValue || placeholder}
        </span>
    );
});

