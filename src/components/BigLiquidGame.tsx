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

import styles from "./BigLiquidGame.module.css";

const BEST_SCORE_KEY = "ascent.bigLiquid.best";
const STEP_S = 1 / 120;

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

    useEffect(() => {
        const resize = () => setScale(fitScale(window.innerWidth, window.innerHeight - 24));
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;

        const state = createGame(loadBest());
        const input: GameInput = { left: false, right: false, up: false, down: false, action: false, actionPressed: false };
        // Created on first key press so audio always follows a user gesture
        let sfx: Sfx | null = null;
        let sfxFailed = false;

        const onKey = (event: KeyboardEvent) => {
            // Leave browser/OS shortcuts alone
            if (event.metaKey || event.ctrlKey) return;
            const down = event.type == "keydown";
            event.preventDefault();
            if (!sfx && !sfxFailed) {
                try {
                    sfx = new Sfx();
                } catch {
                    sfxFailed = true;
                }
            }
            if (down && event.key.toLowerCase() == "m" && !event.repeat) {
                sfx?.toggleMute();
                return;
            }
            const control = KEYMAP[event.key.length == 1 ? event.key.toLowerCase() : event.key];
            if (!control) return;
            if (control == "action" && down && !input.action) input.actionPressed = true;
            input[control] = down;
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
            for (const sound of state.sounds) sfx?.play(sound);
            state.sounds.length = 0;
            const rocket = state.rocket;
            sfx?.setEngine(rocket.burning ? rocket.throttle * (0.3 + 0.7 * density(rocket.alt)) : 0);
            if (state.best != lastBest) {
                lastBest = state.best;
                saveBest(state.best);
            }
            render(ctx, state);
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
            window.removeEventListener("blur", onBlur);
            sfx?.close();
        };
    }, []);

    return (
        <div className={styles.game}>
            <canvas
                ref={canvasRef}
                width={VIEW_W}
                height={VIEW_H}
                style={{ width: VIEW_W * scale, height: VIEW_H * scale }}
            />
            <div className={styles.footer}>M TO MUTE</div>
        </div>
    );
}
