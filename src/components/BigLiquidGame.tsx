"use client";

/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */
import { useEffect, useRef, useState } from "react";

import {
    createGame, density, eraseName, GameInput, GameState, setLeaderboard, setName, typeName, update, VIEW_H, VIEW_W,
} from "@/game/engine";
import { LeaderboardEntry, NAME_MAX } from "@/game/leaderboard";
import { render } from "@/game/render";
import { Sfx } from "@/game/sound";

import TouchControls, { ControlLayout, CONTROLS_MIN_H } from "./TouchControls";
import styles from "./BigLiquidGame.module.css";

const BEST_SCORE_KEY = "ascent.bigLiquid.best";
const NAME_KEY = "bigLiquid.name";
/* Last board seen, so offline flights can still make it */
const BOARD_KEY = "bigLiquid.board";
/* Scores waiting for a connection, oldest first */
const QUEUE_KEY = "bigLiquid.queue";
const STEP_S = 1 / 120;
/* Space between the screen and what's under it */
const GAP = 6;
/* Width of the orange outline drawn around the screen, which needs room at the page edges */
const BORDER = 2;
/*
 * iOS 27 blurs the top edge of home screen web apps. A solid bar this tall pinned to the top (in the page colour)
 * hides it, and on some builds stops it altogether; it also sets the status bar colour, which iOS samples from it.
 */
const BLUR_GUARD = 16;

const KEYMAP: Record<string, keyof Omit<GameInput, "actionPressed">> = {
    ArrowLeft: "left",
    a: "left",
    ArrowRight: "right",
    d: "right",
    ArrowUp: "up",
    w: "up",
    ArrowDown: "down",
    s: "down",
    " ": "action",
    Enter: "action",
};

function loadBest(): number {
    try {
        return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    } catch {
        return 0;
    }
}

function saveBest(score: number) {
    try {
        localStorage.setItem(BEST_SCORE_KEY, String(score));
    } catch {
        // Best score is a nicety; ignore storage failures
    }
}

function loadName(): string {
    try {
        return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
        return "";
    }
}

function saveName(name: string) {
    try {
        localStorage.setItem(NAME_KEY, name);
    } catch {
        // Only used to prefill name entry
    }
}

function loadJson<T>(key: string): T | null {
    try {
        return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    } catch {
        return null;
    }
}

function saveJson(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Offline extras only; the game runs without them
    }
}

/**
 * Talk to the leaderboard API. Resolves to null if the server turns the request down,
 * and rejects if it can't be reached at all, so offline requests can be retried.
 */
async function leaderboardRequest(init?: RequestInit): Promise<LeaderboardEntry[] | null> {
    const response = await fetch("/api/leaderboard", init);
    if (!response.ok) return null;
    const { entries } = (await response.json()) as { entries: LeaderboardEntry[] };
    return entries;
}

/**
 * Space taken by the notch/status bar and home bar, which a home screen launch draws under
 */
function safeArea(): { top: number; bottom: number } {
    const probe = document.createElement("div");
    probe.style.cssText =
        "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const inset = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
    probe.remove();
    return inset;
}

/**
 * Which touch controls a moment of the game needs
 */
function controlLayout(state: GameState, current: ControlLayout): ControlLayout {
    switch (state.phase) {
        // Settle into the flight layout before liftoff, so nothing moves under the player's thumbs at ignition
        case "countdown":
            return "throttle";
        // The throttle only matters while the engine burns (it can relight), and the chute only once it's out
        case "flight":
            return state.rocket.burning ? "throttle" : "coast";
        case "descent":
            return "coast";
        // Nothing to press while it breaks up, so leave the controls where they are until the result
        case "rud":
            return current;
        default:
            return "menu";
    }
}

/**
 * Largest whole-number scale that fits the window, so every pixel stays square (when there's room)
 */
function fitScale(width: number, height: number): number {
    const fit = Math.max(0.1, Math.min(width / VIEW_W, height / VIEW_H));
    return fit >= 1 ? Math.floor(fit) : fit;
}

/**
 * Big Liquid flight minigame, filling the window
 */
export default function BigLiquidGame() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [scale, setScale] = useState<number>(1);
    const [touch, setTouch] = useState<boolean>(false);
    // Launched from the home screen, where iOS blurs the top edge
    const [installed, setInstalled] = useState<boolean>(false);
    const [layout, setLayout] = useState<ControlLayout>("menu");
    // Read by the render loop, which is set up once
    const touchRef = useRef<boolean>(false);
    const stateRef = useRef<GameState | null>(null);
    // Invisible field that brings up the phone keyboard for leaderboard names
    const nameInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<GameInput>({ left: false, right: false, up: false, down: false, action: false, actionPressed: false });
    // Created on first press so audio always follows a user gesture
    const sfxRef = useRef<Sfx | null>(null);
    const sfxFailedRef = useRef<boolean>(false);

    const ensureSfx = () => {
        if (sfxRef.current || sfxFailedRef.current) return;
        try {
            sfxRef.current = new Sfx();
        } catch {
            sfxFailedRef.current = true;
        }
    };

    const press = (control: keyof Omit<GameInput, "actionPressed">, down: boolean) => {
        ensureSfx();
        const input = inputRef.current;
        if (control == "action" && down && !input.action) input.actionPressed = true;
        input[control] = down;
    };

    const toggleMute = () => {
        ensureSfx();
        sfxRef.current?.toggleMute();
    };

    const openKeyboard = () => {
        const state = stateRef.current;
        const field = nameInputRef.current;
        if (!state?.entry || !field || !touchRef.current) return;
        field.value = state.entry.chars.join("");
        field.focus();
    };

    const onNameInput = () => {
        const state = stateRef.current;
        const field = nameInputRef.current;
        if (!state?.entry || !field) return;
        setName(state, field.value);
        // Show only what made it into the name
        field.value = state.entry.chars.join("");
    };

    const onNameKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key != "Enter") return;
        event.preventDefault();
        press("action", true);
        press("action", false);
    };

    // B deletes while typing a leaderboard name, and mutes otherwise
    const pressB = () => {
        const state = stateRef.current;
        if (state?.entry) eraseName(state);
        else toggleMute();
    };

    useEffect(() => {
        const coarse = window.matchMedia("(pointer: coarse)");
        const home = window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)");
        const resize = () => {
            setTouch(coarse.matches);
            setInstalled(home.matches);
            touchRef.current = coarse.matches;
            if (coarse.matches) {
                // Phones fill the width (taller as it goes) as long as the controls keep their minimum height
                const inset = safeArea();
                const width = (window.innerWidth - BORDER * 2) / VIEW_W;
                const height =
                    (window.innerHeight - inset.top - (home.matches ? BLUR_GUARD : 0) - BORDER - GAP - CONTROLS_MIN_H - inset.bottom) /
                    VIEW_H;
                setScale(Math.max(0.1, Math.min(width, height)));
            } else {
                setScale(fitScale(window.innerWidth, window.innerHeight - GAP - 18));
            }
        };
        resize();
        window.addEventListener("resize", resize);
        coarse.addEventListener("change", resize);
        return () => {
            window.removeEventListener("resize", resize);
            coarse.removeEventListener("change", resize);
        };
    }, []);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;

        const state = createGame(loadBest());
        state.lastName = loadName();
        stateRef.current = state;
        const input = inputRef.current;

        let alive = true;
        const showBoard = (entries: LeaderboardEntry[] | null) => {
            if (!alive) return;
            setLeaderboard(state, entries);
            if (entries) saveJson(BOARD_KEY, entries);
        };
        // Offline, the last board seen stays up so a flight can still make it
        const refreshBoard = () => {
            void leaderboardRequest().then(showBoard, () => showBoard(null));
        };

        // Send queued scores, oldest first, stopping at the first one that can't get through.
        // Rows only leave the queue once sent, and new ones only join the end, so this never loses one.
        let syncing = false;
        const sendQueue = async () => {
            if (syncing) return;
            syncing = true;
            try {
                for (;;) {
                    const row = loadJson<LeaderboardEntry[]>(QUEUE_KEY)?.[0];
                    if (!row) break;
                    const entries = await leaderboardRequest({
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(row),
                    });
                    // Sent, or turned down by the server (not worth retrying)
                    saveJson(QUEUE_KEY, (loadJson<LeaderboardEntry[]>(QUEUE_KEY) ?? []).slice(1));
                    showBoard(entries);
                }
            } catch {
                // Still offline; the next "online" event tries again
            } finally {
                syncing = false;
            }
        };
        const onOnline = () => void sendQueue().then(refreshBoard);

        const cachedBoard = loadJson<LeaderboardEntry[]>(BOARD_KEY);
        if (cachedBoard) setLeaderboard(state, cachedBoard);
        onOnline();

        const onKey = (event: KeyboardEvent) => {
            // Leave browser/OS shortcuts and the phone name field alone
            if (event.metaKey || event.ctrlKey || event.target == nameInputRef.current) return;
            const down = event.type == "keydown";
            event.preventDefault();
            // Typing a leaderboard name: letters go into the name rather than steering
            if (state.entry && down) {
                if (event.key == "Backspace" || event.key == "Delete") {
                    eraseName(state);
                    return;
                }
                if (event.key.length == 1 && event.key != " ") {
                    typeName(state, event.key);
                    return;
                }
            }
            if (down && event.key.toLowerCase() == "m" && !event.repeat) {
                toggleMute();
                return;
            }
            const control = KEYMAP[event.key.length == 1 ? event.key.toLowerCase() : event.key];
            if (control) press(control, down);
            else ensureSfx();
        };
        // Don't leave keys stuck down when the tab loses focus
        const onBlur = () => {
            input.left = input.right = input.up = input.down = input.action = false;
            input.actionPressed = false;
        };

        // Touch presses only count as a gesture for audio once the finger lifts
        const unlockAudio = () => {
            ensureSfx();
            sfxRef.current?.unlock();
        };

        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
        window.addEventListener("blur", onBlur);
        window.addEventListener("pointerup", unlockAudio, true);
        window.addEventListener("touchend", unlockAudio, true);
        window.addEventListener("online", onOnline);

        let frame = 0;
        let last = performance.now();
        let acc = 0;
        let lastBest = state.best;
        let lastPhase = state.phase;
        let lastLayout: ControlLayout = "menu";
        const loop = (now: number) => {
            // Clamp so a backgrounded tab doesn't fast-forward the flight
            acc += Math.min(0.1, (now - last) / 1000);
            last = now;
            while (acc >= STEP_S) {
                update(state, input, STEP_S);
                input.actionPressed = false;
                acc -= STEP_S;
            }
            const sfx = sfxRef.current;
            for (const sound of state.sounds) sfx?.play(sound);
            state.sounds.length = 0;
            const rocket = state.rocket;
            sfx?.setEngine(rocket.burning ? rocket.throttle * (0.3 + 0.7 * density(rocket.alt)) : 0);
            if (state.best != lastBest) {
                lastBest = state.best;
                saveBest(state.best);
            }
            // Fresh scores at the start of every flight, so the result screen compares against them
            if (state.phase != lastPhase) {
                lastPhase = state.phase;
                if (state.phase == "fill") refreshBoard();
            }
            const nextLayout = controlLayout(state, lastLayout);
            if (nextLayout != lastLayout) {
                lastLayout = nextLayout;
                setLayout(nextLayout);
            }
            // Put the phone keyboard away once the name is saved
            if (!state.entry && document.activeElement == nameInputRef.current) nameInputRef.current?.blur();
            const outgoing = state.outbox;
            if (outgoing) {
                state.outbox = null;
                saveName(outgoing.name);
                saveJson(QUEUE_KEY, [...(loadJson<LeaderboardEntry[]>(QUEUE_KEY) ?? []), outgoing]);
                void sendQueue();
            }
            render(ctx, state, touchRef.current ? "touch" : "keyboard");
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);

        return () => {
            alive = false;
            cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("pointerup", unlockAudio, true);
            window.removeEventListener("touchend", unlockAudio, true);
            window.removeEventListener("online", onOnline);
            sfxRef.current?.close();
            sfxRef.current = null;
        };
        // press/toggleMute only touch refs, so the loop is set up once
    }, []);

    const guard = touch && installed ? BLUR_GUARD : 0;

    return (
        <div
            className={`${styles.game} ${touch ? styles.touch : ""}`}
            style={{ gap: GAP, paddingTop: touch ? `calc(env(safe-area-inset-top) + ${guard + BORDER}px)` : 0 }}
        >
            {guard > 0 && (
                <div className={styles.blurGuard} style={{ height: `calc(env(safe-area-inset-top) + ${guard}px)` }} aria-hidden />
            )}
            <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                style={{ width: VIEW_W * scale, height: VIEW_H * scale }}
                onClick={openKeyboard}
            />
            <input
                ref={nameInputRef}
                className={styles.nameInput}
                aria-label="Leaderboard name"
                maxLength={NAME_MAX}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onInput={onNameInput}
                onKeyDown={onNameKey}
            />
            {touch ? (
                <TouchControls layout={layout} onDirection={press} onAction={(down) => press("action", down)} onMute={pressB} />
            ) : (
                <div className={styles.footer}>M TO MUTE</div>
            )}
        </div>
    );
}
