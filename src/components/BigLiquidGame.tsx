"use client";

/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */
import { useEffect, useRef, useState } from "react";

import { createGame, density, GameInput, update, VIEW_H, VIEW_W } from "@/game/engine";
import { render } from "@/game/render";
import { Sfx } from "@/game/sound";

import TouchControls from "./TouchControls";
import styles from "./BigLiquidGame.module.css";

const BEST_SCORE_KEY = "ascent.bigLiquid.best";
const STEP_S = 1 / 120;
/* Height kept free under the screen for the touch controls */
const CONTROLS_H = 190;

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
    // Read by the render loop, which is set up once
    const touchRef = useRef<boolean>(false);
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

    useEffect(() => {
        const coarse = window.matchMedia("(pointer: coarse)");
        const resize = () => {
            setTouch(coarse.matches);
            touchRef.current = coarse.matches;
            setScale(fitScale(window.innerWidth, window.innerHeight - (coarse.matches ? CONTROLS_H : 24)));
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
        const input = inputRef.current;

        const onKey = (event: KeyboardEvent) => {
            // Leave browser/OS shortcuts alone
            if (event.metaKey || event.ctrlKey) return;
            const down = event.type == "keydown";
            event.preventDefault();
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

        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
        window.addEventListener("blur", onBlur);

        let frame = 0;
        let last = performance.now();
        let acc = 0;
        let lastBest = state.best;
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
            render(ctx, state, touchRef.current ? "touch" : "keyboard");
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
            window.removeEventListener("blur", onBlur);
            sfxRef.current?.close();
            sfxRef.current = null;
        };
        // press/toggleMute only touch refs, so the loop is set up once
    }, []);

    return (
        <div className={styles.game}>
            <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                style={{ width: VIEW_W * scale, height: VIEW_H * scale }}
            />
            {touch ? (
                <TouchControls onDirection={press} onAction={(down) => press("action", down)} onMute={toggleMute} />
            ) : (
                <div className={styles.footer}>M TO MUTE</div>
            )}
        </div>
    );
}
