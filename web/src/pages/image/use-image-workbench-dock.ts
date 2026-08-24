import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

const PIN_KEY = "prolab:image-workbench:v1:pinned";
const DESKTOP_QUERY = "(min-width: 1024px)";

function readPinned() {
    try {
        return window.localStorage.getItem(PIN_KEY) === "1";
    } catch {
        return false;
    }
}

function writePinned(pinned: boolean) {
    try {
        window.localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch {
        // ignore quota / private mode
    }
}

function hasOpenOverlay() {
    return Boolean(
        document.querySelector(
            ".ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-dropdown:not(.ant-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-modal-wrap, .ant-popover:not(.ant-popover-hidden)",
        ),
    );
}

export function useImageWorkbenchDock() {
    const [pinned, setPinned] = useState(readPinned);
    const [collapsed, setCollapsed] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [desktop, setDesktop] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(DESKTOP_QUERY).matches));
    const leaveTimer = useRef(0);

    useEffect(() => {
        const media = window.matchMedia(DESKTOP_QUERY);
        const sync = () => setDesktop(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, []);

    useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

    const expanded = !desktop || pinned || hovered || focused || !collapsed;

    const collapseAfterGenerate = useCallback(() => {
        if (!desktop || pinned) return;
        setCollapsed(true);
        setHovered(false);
        setFocused(false);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }, [desktop, pinned]);

    const togglePin = useCallback(() => {
        setPinned((current) => {
            const next = !current;
            writePinned(next);
            if (next) setCollapsed(false);
            return next;
        });
    }, []);

    const onMouseEnter = useCallback(() => {
        if (!desktop) return;
        window.clearTimeout(leaveTimer.current);
        setHovered(true);
    }, [desktop]);

    const onMouseLeave = useCallback(() => {
        if (!desktop) return;
        window.clearTimeout(leaveTimer.current);
        const hide = () => {
            if (hasOpenOverlay()) {
                leaveTimer.current = window.setTimeout(hide, 280);
                return;
            }
            setHovered(false);
        };
        leaveTimer.current = window.setTimeout(hide, 280);
    }, [desktop]);

    const onFocusCapture = useCallback(() => setFocused(true), []);

    const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
    }, []);

    return {
        pinned,
        expanded,
        collapseAfterGenerate,
        togglePin,
        onMouseEnter,
        onMouseLeave,
        onFocusCapture,
        onBlurCapture,
    };
}
