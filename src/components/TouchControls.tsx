"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

import styles from "./TouchControls.module.css";

export type Direction = "up" | "down" | "left" | "right";
/**
 * menu: full D-pad with big A/B, for everything off the pad
 * throttle: steering pad and throttle pad, while the engine burns
 * coast: steering pad and a big A for the chute, once it's out
 */
export type ControlLayout = "menu" | "throttle" | "coast";
type Axes = "both" | "horizontal" | "vertical";

/* Shortest the control area gets; the screen above scales to leave this much room */
export const CONTROLS_MIN_H = 190;

const AXIS_DIRECTIONS: Record<Axes, Direction[]> = {
    both: ["up", "down", "left", "right"],
    horizontal: ["left", "right"],
    vertical: ["up", "down"],
};
/* Pixels from the pad's centre before a press counts */
const DEAD_ZONE = 10;
/* How far off-axis a press can be and still count, so corners give diagonals */
const DIAGONAL = 0.4;
/* Up/down drive the throttle, so a drag that starts on left/right has to reach halfway along the arm (arms span 20-60px out) */
const THROTTLE_DEAD_ZONE = 40;
/* Up/down for any other press */
const THROTTLE_TAP_ZONE = 10;

interface TouchControlsProps {
    layout: ControlLayout;
    onDirection: (direction: Direction, down: boolean) => void;
    onAction: (down: boolean) => void;
    onMute: () => void;
}

/**
 * Game Boy-style D-pad and A/B buttons for touch screens
 */
export default function TouchControls({ layout, onDirection, onAction, onMute }: TouchControlsProps) {
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

    const onB = (down: boolean) => down && onMute();

    // Keys make each pad/button remount on a layout change, which lets go of anything held
    return (
        <div ref={controlsRef} className={styles.controls} style={{ minHeight: CONTROLS_MIN_H }}>
            {layout == "menu" ? (
                <div className={styles.menu}>
                    <Pad key="menu-pad" axes="both" onDirection={onDirection} />
                    <div className={styles.buttons}>
                        <HoldButton key="menu-b" label="B" caption="MUTE" className={styles.b} onChange={onB} />
                        <HoldButton key="menu-a" label="A" caption="ACTION" className={styles.a} onChange={onAction} />
                    </div>
                </div>
            ) : (
                <div className={styles.flight}>
                    <Pad key="steer" axes="horizontal" onDirection={onDirection} />
                    {layout == "throttle" ? (
                        <Pad key="throttle" axes="vertical" onDirection={onDirection} />
                    ) : (
                        <div className={`${styles.zone} ${styles.chuteZone}`}>
                            <HoldButton key="chute" label="A" caption="CHUTE" onChange={onAction} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * D-pad limited to some axes. Directions come from where the finger is relative to the visible pad's centre,
 * so the whole element around it is touchable and sliding between arms works.
 */
function Pad({ axes, onDirection }: { axes: Axes; onDirection: (direction: Direction, down: boolean) => void }) {
    const [held, setHeld] = useState<Set<Direction>>(new Set());
    const heldRef = useRef<Set<Direction>>(held);
    // Whether the current press began on left/right alone, so sliding off them shouldn't easily catch the throttle
    const steeringRef = useRef<boolean>(false);
    const crossRef = useRef<HTMLDivElement>(null);
    const directions = AXIS_DIRECTIONS[axes];

    const setDirections = (next: Set<Direction>) => {
        for (const d of directions) {
            if (next.has(d) != heldRef.current.has(d)) onDirection(d, next.has(d));
        }
        heldRef.current = next;
        setHeld(next);
    };

    // A layout change can swap the pad out mid-press, with no pointerup to follow
    useEffect(
        () => () => {
            for (const d of heldRef.current) onDirection(d, false);
        },
        // onDirection only touches refs, so the one from mount is fine to call on unmount
        [],
    );

    const trackPad = (event: PointerEvent<HTMLDivElement>) => {
        const rect = (crossRef.current ?? event.currentTarget).getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const next = new Set<Direction>();
        if (axes == "both" && Math.hypot(dx, dy) <= DEAD_ZONE) {
            setDirections(next);
            return next;
        }
        if (axes != "horizontal") {
            const zone = axes == "both" && steeringRef.current ? THROTTLE_DEAD_ZONE : THROTTLE_TAP_ZONE;
            // A single-axis pad takes any press on its side, however far off-axis
            const lean = axes == "both" ? Math.abs(dx) * DIAGONAL : 0;
            if (-dy > zone && -dy > lean) next.add("up");
            if (dy > zone && dy > lean) next.add("down");
        }
        if (axes != "vertical") {
            const lean = axes == "both" ? Math.abs(dy) * DIAGONAL : 0;
            if (-dx > DEAD_ZONE && -dx > lean) next.add("left");
            if (dx > DEAD_ZONE && dx > lean) next.add("right");
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

    const labels: Record<Axes, string> = { both: "Direction pad", horizontal: "Steering", vertical: "Throttle" };
    const zones: Record<Axes, string | undefined> = {
        both: styles.dpad,
        horizontal: `${styles.zone} ${styles.steerZone}`,
        vertical: `${styles.zone} ${styles.throttleZone}`,
    };

    return (
        <div
            className={zones[axes]}
            onPointerDown={padDown}
            onPointerMove={padMove}
            onPointerUp={padUp}
            onPointerCancel={padUp}
            aria-label={labels[axes]}
        >
            <div ref={crossRef} className={`${styles.cross} ${axes == "both" ? "" : styles[axes]}`}>
                {directions.map((d) => (
                    <span key={d} className={`${styles.arm} ${styles[d]} ${held.has(d) ? styles.pressed : ""}`} />
                ))}
                <span className={styles.hub} />
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
    const pressedRef = useRef<boolean>(false);

    const set = (down: boolean) => {
        pressedRef.current = down;
        setPressed(down);
        onChange(down);
    };

    // Don't leave A held if a layout change swaps the button out mid-press
    useEffect(
        () => () => {
            if (pressedRef.current) onChange(false);
        },
        [],
    );

    return (
        <div className={`${styles.buttonWrap} ${className ?? ""}`}>
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
