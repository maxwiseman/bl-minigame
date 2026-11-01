"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

import styles from "./TouchControls.module.css";

export type Direction = "up" | "down" | "left" | "right";

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
/* Pixels from the pad's centre before a press counts */
const DEAD_ZONE = 10;
/* Up/down drive the throttle, so a drag that starts on left/right has to reach halfway along the arm (arms span 20-60px out) */
const THROTTLE_DEAD_ZONE = 40;
/* Up/down for any other press */
const THROTTLE_TAP_ZONE = 10;
/* How far off-axis a press can be and still count, so corners give diagonals */
const DIAGONAL = 0.4;

interface TouchControlsProps {
    onDirection: (direction: Direction, down: boolean) => void;
    onAction: (down: boolean) => void;
    onMute: () => void;
}

/**
 * Game Boy-style D-pad and A/B buttons for touch screens
 */
export default function TouchControls({ onDirection, onAction, onMute }: TouchControlsProps) {
    const [held, setHeld] = useState<Set<Direction>>(new Set());
    const heldRef = useRef<Set<Direction>>(held);

    const setDirections = (next: Set<Direction>) => {
        for (const d of DIRECTIONS) {
            if (next.has(d) != heldRef.current.has(d)) onDirection(d, next.has(d));
        }
        heldRef.current = next;
        setHeld(next);
    };

    // Directions come from where the finger is on the pad, so sliding between arms works
    // Whether the current press began on left/right alone, so sliding off them shouldn't easily catch the throttle
    const steeringRef = useRef<boolean>(false);

    const trackPad = (event: PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const throttleZone = steeringRef.current ? THROTTLE_DEAD_ZONE : THROTTLE_TAP_ZONE;
        const next = new Set<Direction>();
        if (Math.hypot(dx, dy) > DEAD_ZONE) {
            if (-dy > throttleZone && -dy > Math.abs(dx) * DIAGONAL) next.add("up");
            if (dy > throttleZone && dy > Math.abs(dx) * DIAGONAL) next.add("down");
            if (-dx > Math.abs(dy) * DIAGONAL) next.add("left");
            if (dx > Math.abs(dy) * DIAGONAL) next.add("right");
        }
        setDirections(next);
        return next;
    };

    const padDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        steeringRef.current = false;
        const start = trackPad(event);
        steeringRef.current = (start.has("left") || start.has("right")) && !start.has("up") && !start.has("down");
    };
    const padMove = (event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) trackPad(event);
    };
    const padUp = () => setDirections(new Set());

    // iOS ignores user-select during long-press drags, so cancel the touch itself; pointer events still fire.
    // Needs a native listener, since React's touch listeners are passive.
    const controlsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls) return;
        const block = (event: TouchEvent) => event.preventDefault();
        controls.addEventListener("touchstart", block, { passive: false });
        return () => controls.removeEventListener("touchstart", block);
    }, []);

    return (
        <div ref={controlsRef} className={styles.controls}>
            <div
                className={styles.dpad}
                onPointerDown={padDown}
                onPointerMove={padMove}
                onPointerUp={padUp}
                onPointerCancel={padUp}
                aria-label="Direction pad"
            >
                <div className={styles.cross}>
                    {DIRECTIONS.map((d) => (
                        <span key={d} className={`${styles.arm} ${styles[d]} ${held.has(d) ? styles.pressed : ""}`} />
                    ))}
                    <span className={styles.hub} />
                </div>
            </div>

            <div className={styles.buttons}>
                <HoldButton label="B" caption="MUTE" className={styles.b} onChange={(down) => down && onMute()} />
                <HoldButton label="A" caption="ACTION" className={styles.a} onChange={onAction} />
            </div>
        </div>
    );
}

function HoldButton({
    label,
    caption,
    className,
    onChange,
}: {
    label: string;
    caption: string;
    className?: string;
    onChange: (down: boolean) => void;
}) {
    const [pressed, setPressed] = useState<boolean>(false);

    const set = (down: boolean) => {
        setPressed(down);
        onChange(down);
    };

    return (
        <div className={`${styles.buttonWrap} ${className}`}>
            <button
                type="button"
                className={`${styles.button} ${pressed ? styles.pressed : ""}`}
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    navigator.vibrate?.(8);
                    set(true);
                }}
                onPointerUp={() => set(false)}
                onPointerCancel={() => set(false)}
                onContextMenu={(event) => event.preventDefault()}
            >
                {label}
            </button>
            <span className={styles.caption}>{caption}</span>
        </div>
    );
}
