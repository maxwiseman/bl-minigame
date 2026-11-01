/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */
import { cleanName, LEADERBOARD_SIZE, LeaderboardEntry, NAME_CHARS, NAME_MAX, qualifies } from "./leaderboard";

/* Internal (pre-scaling) resolution of the game */
export const VIEW_W = 180;
export const VIEW_H = 240;

/* Screen row the rocket's nozzle sits on; the camera follows the rocket */
export const ROCKET_Y = 200;
export const ROCKET_H = 30;
export const PX_PER_FT = 0.05;

/* Flight model (game units, tuned for gameplay rather than realism) */
const GRAVITY = 200;
const THRUST = 540;
const DRAG_K = 5.5e-5;
const DENSITY_SCALE_FT = 44000;
/* Never let the air vanish entirely, so long burns still hit the q limit at full throttle */
const DENSITY_FLOOR = 0.2;
const BURN_TIME_S = 24;
const Q_LIMIT = 2.6e6;
const STRESS_RATE = 0.9;
const MIN_THROTTLE = 0.4;

/* Fill minigame */
const FILL_BAND: [number, number] = [0.86, 0.95];

/* Difficulty ramp: climb rate is multiplied by this once the flight gets going */
const SPEEDUP_START_S = 25;
const SPEEDUP_PER_S = 0.012;
const SPEEDUP_MAX = 1.7;

/* Fuel pickups: interval between them grows so every flight eventually ends */
const FUEL_FIRST_S = 8;
const FUEL_INTERVAL_S = 2.6;
const FUEL_INTERVAL_GROWTH_S = 0.6;
const FUEL_PER_PICKUP = 0.14;

/* Spawning */
export const SPAWN_AHEAD_FT = 4400;
/* Hazards are rolled this much further ahead and sit dormant until SPAWN_AHEAD_FT, so jets can be announced early */
const LOOKAHEAD_FT = 8000;

/* Recovery timing (ft/s of vertical speed at the moment of deploy) */
const PERFECT_DEPLOY_VEL = 120;
const GOOD_DEPLOY_VEL = 360;
const BALLISTIC_VEL = -520;

export type Phase = "title" | "fill" | "countdown" | "flight" | "descent" | "rud" | "result";
export type EntityKind = "bird" | "balloon" | "jet" | "junk" | "packet" | "fuel" | "gust" | "cloud";
export type Recovery = "none" | "perfect" | "good" | "zipper" | "ballistic";
export type GameSound = "blip" | "fill" | "vent" | "ignite" | "pickup" | "hit" | "explode" | "meco" | "deploy" | "warn" | "refuel";

export interface GameInput {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    action: boolean;
    /* True only on the frame the action key went down */
    actionPressed: boolean;
}

export interface Entity {
    kind: EntityKind;
    x: number;
    alt: number;
    vx: number;
    valt: number;
    /* Hitbox in screen pixels */
    w: number;
    h: number;
    /* Free-running timer for animation */
    t: number;
    dead: boolean;
    /* Gust strength / cloud variant */
    param: number;
}

export interface Particle {
    x: number;
    alt: number;
    vx: number;
    valt: number;
    life: number;
    maxLife: number;
    size: number;
    kind: "smoke" | "fire" | "spark" | "debris";
}

export interface Rocket {
    x: number;
    alt: number;
    vel: number;
    vx: number;
    tilt: number;
    throttle: number;
    prop: number;
    burning: boolean;
    stress: number;
    chute: boolean;
}

export interface Tank {
    name: string;
    level: number;
    locked: boolean;
    vented: boolean;
    /* Only true after a fresh press on this tank, so a held key can't carry over */
    filling: boolean;
}

/* Arcade-style name entry for a leaderboard score */
export interface NameEntry {
    chars: string[];
    /* Character being edited; chars.length means the empty slot after the name */
    cursor: number;
    /* D-pad direction currently held, for key repeat */
    held: "up" | "down" | "left" | "right" | null;
    repeat: number;
}

export interface GameState {
    phase: Phase;
    /* Time spent in the current phase */
    phaseTime: number;
    time: number;
    rocket: Rocket;
    tanks: [Tank, Tank];
    activeTank: number;
    /* Fill briefing has been dismissed */
    fillStarted: boolean;
    entities: Entity[];
    particles: Particle[];
    nextSpawnAlt: number;
    nextCloudAlt: number;
    /* Flight time at which the next fuel pickup spawns */
    nextFuelTime: number;
    fuelSpawned: number;
    /* Current climb-rate multiplier */
    speed: number;
    packets: number;
    apogee: number;
    recovery: Recovery;
    failure: string | null;
    shake: number;
    /* Short-lived center-screen callout, e.g. "MAX-Q" */
    callout: { text: string; time: number } | null;
    maxQPassed: boolean;
    spaceReached: boolean;
    score: number;
    best: number;
    newBest: boolean;
    /* Top scores; null while loading or unreachable */
    board: LeaderboardEntry[] | null;
    boardOffline: boolean;
    /* This flight's score has been checked against the board */
    boardChecked: boolean;
    entry: NameEntry | null;
    /* This flight's submitted row, for highlighting */
    submitted: LeaderboardEntry | null;
    /* Waiting to be sent to the server by the host */
    outbox: LeaderboardEntry | null;
    /* Name used last time, offered again */
    lastName: string;
    sounds: GameSound[];
    rng: () => number;
}

export const FILL_TARGET = FILL_BAND;

/* Scoring */
export const PACKET_POINTS = 500;
export const RECOVERY_BONUS: Record<Recovery, number> = { none: 0, perfect: 10000, good: 5000, zipper: 0, ballistic: 0 };
/* Share of the score lost when the vehicle breaks up */
export const RUD_PENALTY = 0.10;

function newRocket(): Rocket {
    return {
        x: VIEW_W / 2,
        alt: 0,
        vel: 0,
        vx: 0,
        tilt: 0,
        throttle: 1,
        prop: 0,
        burning: false,
        stress: 0,
        chute: false,
    };
}

/**
 * Create a fresh game sitting on the title screen
 * @param best previous high score
 * @param rng random source (seedable for tests)
 */
export function createGame(best: number = 0, rng: () => number = Math.random): GameState {
    return {
        phase: "title",
        phaseTime: 0,
        time: 0,
        rocket: newRocket(),
        tanks: [
            { name: "NOS", level: 0, locked: false, vented: false, filling: false },
            { name: "GOX", level: 0, locked: false, vented: false, filling: false },
        ],
        activeTank: 0,
        fillStarted: false,
        entities: [],
        particles: [],
        nextSpawnAlt: 1800,
        nextCloudAlt: 5000,
        nextFuelTime: FUEL_FIRST_S,
        fuelSpawned: 0,
        speed: 1,
        packets: 0,
        apogee: 0,
        recovery: "none",
        failure: null,
        shake: 0,
        callout: null,
        maxQPassed: false,
        spaceReached: false,
        score: 0,
        best,
        newBest: false,
        board: null,
        boardOffline: false,
        boardChecked: false,
        entry: null,
        submitted: null,
        outbox: null,
        lastName: "",
        sounds: [],
        rng,
    };
}

/**
 * Air density relative to the pad
 */
export function density(alt: number): number {
    return Math.max(DENSITY_FLOOR, Math.exp(-Math.max(0, alt) / DENSITY_SCALE_FT));
}

/**
 * Dynamic pressure as a fraction of the structural limit
 */
export function qRatio(rocket: Rocket): number {
    return (density(rocket.alt) * rocket.vel * rocket.vel) / Q_LIMIT;
}

/**
 * Climb-rate multiplier for a given time since liftoff ("the air keeps getting thinner")
 */
export function speedMultiplier(flightTime: number): number {
    return Math.min(SPEEDUP_MAX, 1 + Math.max(0, flightTime - SPEEDUP_START_S) * SPEEDUP_PER_S);
}

/**
 * Whether a hazard has been rolled but hasn't entered play yet (it wakes SPAWN_AHEAD_FT above the rocket)
 */
export function isDormant(e: Entity, rocketAlt: number): boolean {
    return e.alt - rocketAlt > SPAWN_AHEAD_FT;
}

/**
 * Convert a world altitude to a screen row given the camera (rocket) altitude
 */
export function toScreenY(alt: number, cameraAlt: number): number {
    return ROCKET_Y - (alt - cameraAlt) * PX_PER_FT;
}

function setPhase(state: GameState, phase: Phase) {
    state.phase = phase;
    state.phaseTime = 0;
}

function callout(state: GameState, text: string) {
    state.callout = { text, time: 0 };
}

/**
 * Advance the game by dt seconds
 */
export function update(state: GameState, input: GameInput, dt: number): void {
    state.time += dt;
    state.phaseTime += dt;
    state.shake = Math.max(0, state.shake - dt * 8);
    if (state.callout) {
        state.callout.time += dt;
        if (state.callout.time > 1.6) state.callout = null;
    }

    switch (state.phase) {
        case "title":
            if (input.actionPressed) {
                state.sounds.push("blip");
                setPhase(state, "fill");
            }
            break;
        case "fill":
            updateFill(state, input, dt);
            emitVapor(state, dt);
            break;
        case "countdown":
            emitVapor(state, dt);
            if (state.phaseTime >= 3) {
                state.rocket.burning = true;
                state.sounds.push("ignite");
                callout(state, "LIFTOFF!");
                setPhase(state, "flight");
            }
            break;
        case "flight":
            updateFlight(state, input, dt);
            break;
        case "descent":
            updateDescent(state, dt);
            break;
        case "rud":
            if (state.phaseTime > 2.2) finish(state);
            break;
        case "result":
            checkBoard(state);
            if (state.entry) {
                updateNameEntry(state, input, dt);
                break;
            }
            if (state.phaseTime > 0.8 && input.actionPressed) {
                const next = createGame(state.best, state.rng);
                // The leaderboard and player outlive a flight
                next.board = state.board;
                next.boardOffline = state.boardOffline;
                next.lastName = state.lastName;
                Object.assign(state, next);
                state.sounds.push("blip");
                setPhase(state, "fill");
            }
            break;
    }

    updateParticles(state, dt);
}

function updateFill(state: GameState, input: GameInput, dt: number) {
    const tank = state.tanks[state.activeTank];
    if (tank == undefined) {
        // Both tanks are locked; give the player a beat to read the result
        if (state.phaseTime > 1.4) {
            const rocket = state.rocket;
            rocket.prop = Math.min(usableLevel(state.tanks[0].level), usableLevel(state.tanks[1].level));
            setPhase(state, "countdown");
        }
        return;
    }

    if (!state.fillStarted) {
        if (input.actionPressed) {
            state.fillStarted = true;
            state.sounds.push("blip");
        }
        return;
    }

    if (input.actionPressed && !tank.locked) tank.filling = true;
    if (!tank.filling) return;

    if (input.action) {
        // Flow accelerates as tank pressure equalises, which makes the top of the band tricky
        tank.level += (0.22 + tank.level * 0.55) * dt;
        if (Math.floor(state.time * 12) != Math.floor((state.time - dt) * 12)) state.sounds.push("fill");
        if (tank.level > 1) {
            tank.level = 0.62;
            tank.vented = true;
            tank.locked = true;
            state.shake = 1;
            state.sounds.push("vent");
            nextTank(state);
        }
    } else {
        tank.locked = true;
        state.sounds.push("blip");
        nextTank(state);
    }
}

function nextTank(state: GameState) {
    state.activeTank += 1;
    if (state.activeTank >= state.tanks.length) state.phaseTime = 0;
}

/**
 * Propellant actually available from a tank; filling past the band eats into ullage and
 * the excess boils off before liftoff
 */
export function usableLevel(level: number): number {
    return level > FILL_BAND[1] ? FILL_BAND[1] - (level - FILL_BAND[1]) * 4 : level;
}

/**
 * Whether a tank level landed inside the target band
 */
export function inFillBand(level: number): boolean {
    return level >= FILL_BAND[0] && level <= FILL_BAND[1];
}

function updateFlight(state: GameState, input: GameInput, dt: number) {
    const rocket = state.rocket;

    // Throttle (deep-throttling liquid engine)
    if (rocket.burning) {
        if (input.up) rocket.throttle = Math.min(1, rocket.throttle + dt * 0.9);
        if (input.down) rocket.throttle = Math.max(MIN_THROTTLE, rocket.throttle - dt * 0.9);
    }

    // Steering: thrust vectoring while burning, fins only afterwards
    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const authority = rocket.burning ? 1 : 0.55;
    rocket.tilt += (steer * authority - rocket.tilt) * Math.min(1, dt * 6);

    let wind = 0;
    for (const e of state.entities) {
        if (e.kind != "gust") continue;
        const sy = toScreenY(e.alt, rocket.alt);
        if (Math.abs(sy - (ROCKET_Y - ROCKET_H / 2)) < e.h / 2) wind += e.param;
    }
    rocket.vx += (rocket.tilt * 75 + wind - rocket.vx) * Math.min(1, dt * 4);
    rocket.x += rocket.vx * dt;
    if (rocket.x < 8 || rocket.x > VIEW_W - 8) {
        rocket.x = Math.max(8, Math.min(VIEW_W - 8, rocket.x));
        rocket.vx = 0;
    }

    // Vertical dynamics
    const rho = density(rocket.alt);
    const thrust = rocket.burning ? THRUST * rocket.throttle : 0;
    const drag = DRAG_K * rho * rocket.vel * Math.abs(rocket.vel);
    rocket.vel += (thrust - GRAVITY - drag) * dt;
    const previousSpeed = state.speed;
    state.speed = speedMultiplier(state.phaseTime);
    if (Math.floor(state.speed * 4) > Math.floor(previousSpeed * 4)) callout(state, `SPEED x${+state.speed.toFixed(2)}`);
    rocket.alt += rocket.vel * state.speed * dt;
    if (rocket.alt < 0) {
        rocket.alt = 0;
        rocket.vel = Math.max(0, rocket.vel);
    }

    if (rocket.burning) {
        rocket.prop -= (rocket.throttle / BURN_TIME_S) * dt;
        emitExhaust(state, dt);
        if (rocket.prop <= 0) {
            rocket.prop = 0;
            rocket.burning = false;
            state.sounds.push("meco");
            callout(state, "MECO");
        }
    }

    // Structural loads
    const q = qRatio(rocket);
    if (q > 1) {
        rocket.stress += (q - 1) * STRESS_RATE * dt;
        if (Math.floor(state.time * 4) != Math.floor((state.time - dt) * 4)) state.sounds.push("warn");
    } else {
        rocket.stress = Math.max(0, rocket.stress - dt * 0.2);
    }
    if (!state.maxQPassed && q > 0.8) {
        state.maxQPassed = true;
        callout(state, "MAX-Q");
    }
    if (rocket.stress >= 1) {
        rapidUnscheduledDisassembly(state, "STRUCTURAL FAILURE");
        return;
    }

    state.apogee = Math.max(state.apogee, rocket.alt);
    if (!state.spaceReached && rocket.alt > 328084) {
        state.spaceReached = true;
        callout(state, "SPACE!");
    }

    spawnEntities(state);
    updateEntities(state, dt);
    if (state.phase != "flight") return;

    // Recovery: deploy as close to apogee as possible
    if (!rocket.burning && input.actionPressed) {
        const v = Math.abs(rocket.vel);
        state.recovery = v < PERFECT_DEPLOY_VEL ? "perfect" : v < GOOD_DEPLOY_VEL ? "good" : "zipper";
        deploy(state);
    } else if (!rocket.burning && rocket.vel < BALLISTIC_VEL) {
        state.recovery = "ballistic";
        callout(state, "NO CHUTE!");
        state.sounds.push("warn");
        setPhase(state, "descent");
    }
}

function deploy(state: GameState) {
    const labels: Record<Recovery, string> = {
        none: "",
        perfect: "PERFECT DEPLOY!",
        good: "GOOD DEPLOY",
        zipper: "ZIPPERED!",
        ballistic: "",
    };
    callout(state, labels[state.recovery]);
    state.rocket.chute = state.recovery != "zipper";
    state.sounds.push(state.recovery == "zipper" ? "hit" : "deploy");
    if (state.recovery == "zipper") state.shake = 1;
    setPhase(state, "descent");
}

function updateDescent(state: GameState, dt: number) {
    const rocket = state.rocket;
    // Ease toward terminal velocity under canopy (or not)
    const terminal = rocket.chute ? -180 : -1800;
    rocket.vel += (terminal - rocket.vel) * Math.min(1, dt * (rocket.chute ? 2.5 : 0.8));
    rocket.alt += rocket.vel * dt;
    rocket.vx *= 1 - Math.min(1, dt * 2);
    rocket.x += rocket.vx * dt;
    rocket.tilt *= 1 - Math.min(1, dt * 2);
    updateEntities(state, dt);
    if (state.phaseTime > 3) finish(state);
}

function rapidUnscheduledDisassembly(state: GameState, reason: string) {
    const rocket = state.rocket;
    state.failure = reason;
    rocket.burning = false;
    state.shake = 3;
    state.sounds.push("explode");
    for (let i = 0; i < 90; i++) {
        const a = state.rng() * Math.PI * 2;
        const s = 20 + state.rng() * 90;
        const kind = i < 50 ? "fire" : i < 75 ? "smoke" : "debris";
        state.particles.push({
            x: rocket.x,
            alt: rocket.alt + 300,
            vx: Math.cos(a) * s,
            valt: Math.sin(a) * s * 20 + rocket.vel * 0.3,
            life: 0,
            maxLife: 0.6 + state.rng() * (kind == "smoke" ? 2 : 1),
            size: kind == "smoke" ? 3 : 1,
            kind,
        });
    }
    setPhase(state, "rud");
}

function finish(state: GameState) {
    const earned = Math.round(state.apogee) + state.packets * PACKET_POINTS;
    state.score = state.failure ? Math.round(earned * (1 - RUD_PENALTY)) : earned + RECOVERY_BONUS[state.recovery];
    state.newBest = state.score > state.best;
    state.best = Math.max(state.best, state.score);
    setPhase(state, "result");
}

/**
 * Give the game the latest top scores (null if the leaderboard couldn't be reached)
 */
export function setLeaderboard(state: GameState, entries: LeaderboardEntry[] | null): void {
    state.boardOffline = entries == null;
    if (entries) state.board = entries.slice(0, LEADERBOARD_SIZE);
    checkBoard(state);
}

/* Once per flight, offer name entry if the score makes the board */
function checkBoard(state: GameState) {
    if (state.phase != "result" || state.boardChecked || !state.board) return;
    state.boardChecked = true;
    if (!qualifies(state.board, state.score)) return;
    const chars = [...state.lastName];
    state.entry = { chars, cursor: chars.length, held: null, repeat: 0 };
}

/**
 * Typed character during name entry (keyboard)
 */
export function typeName(state: GameState, ch: string): void {
    const entry = state.entry;
    const c = ch.toUpperCase();
    if (!entry || c.length != 1 || !NAME_CHARS.includes(c)) return;
    if (entry.cursor < entry.chars.length) entry.chars[entry.cursor] = c;
    else if (entry.chars.length < NAME_MAX) entry.chars.push(c);
    else return;
    entry.cursor += 1;
}

/**
 * Replace the whole name (phone keyboard), dropping anything the font can't show
 */
export function setName(state: GameState, text: string): void {
    const entry = state.entry;
    if (!entry) return;
    entry.chars = [...text.toUpperCase()].filter((c) => NAME_CHARS.includes(c)).slice(0, NAME_MAX);
    entry.cursor = entry.chars.length;
}

/**
 * Delete during name entry: the character being edited, or the last one
 */
export function eraseName(state: GameState): void {
    const entry = state.entry;
    if (!entry) return;
    if (entry.cursor < entry.chars.length) entry.chars.splice(entry.cursor, 1);
    else entry.chars.pop();
    entry.cursor = Math.min(entry.cursor, entry.chars.length);
}

function updateNameEntry(state: GameState, input: GameInput, dt: number) {
    const entry = state.entry!;
    const dir = input.up ? "up" : input.down ? "down" : input.left ? "left" : input.right ? "right" : null;
    if (dir != entry.held) {
        entry.held = dir;
        entry.repeat = 0.35;
        if (dir) stepNameEntry(state, entry, dir);
    } else if (dir) {
        entry.repeat -= dt;
        if (entry.repeat <= 0) {
            entry.repeat = dir == "up" || dir == "down" ? 0.08 : 0.15;
            stepNameEntry(state, entry, dir);
        }
    }

    if (input.actionPressed && state.phaseTime > 0.8) {
        const name = cleanName(entry.chars.join(""));
        if (!name) {
            state.sounds.push("warn");
            return;
        }
        const row = { name, score: state.score };
        state.outbox = row;
        state.submitted = row;
        state.lastName = name;
        state.entry = null;
        // Show it straight away; the server's answer replaces this
        state.board = [...(state.board ?? []), row].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_SIZE);
        state.sounds.push("pickup");
    }
}

function stepNameEntry(state: GameState, entry: NameEntry, dir: "up" | "down" | "left" | "right") {
    if (dir == "up" || dir == "down") {
        if (entry.cursor == entry.chars.length) {
            if (entry.chars.length >= NAME_MAX) return;
            entry.chars.push("A");
        } else {
            const i = NAME_CHARS.indexOf(entry.chars[entry.cursor]!);
            const step = dir == "up" ? 1 : -1;
            entry.chars[entry.cursor] = NAME_CHARS[(i + step + NAME_CHARS.length) % NAME_CHARS.length]!;
        }
    } else if (dir == "right") {
        if (entry.cursor < entry.chars.length) entry.cursor += 1;
    } else {
        entry.cursor = Math.max(0, entry.cursor - 1);
    }
    state.sounds.push("blip");
}

function emitExhaust(state: GameState, dt: number) {
    const rocket = state.rocket;
    const rho = density(rocket.alt);
    const rate = (rocket.alt < 800 ? 70 : 30) * rho * rocket.throttle;
    let n = rate * dt;
    while (n > 0) {
        if (n < 1 && state.rng() > n) break;
        n -= 1;
        const pad = rocket.alt < 600;
        state.particles.push({
            x: rocket.x + (state.rng() - 0.5) * 4,
            alt: rocket.alt - 120 - state.rng() * 80,
            vx: (state.rng() - 0.5) * (pad ? 90 : 14),
            valt: rocket.vel * 0.1 - state.rng() * 80,
            life: 0,
            maxLife: 1.2 + state.rng() * (pad ? 2.6 : 1.4),
            size: 2,
            kind: "smoke",
        });
    }
}

/**
 * Nitrous venting from the vehicle while it sits loaded on the pad
 */
function emitVapor(state: GameState, dt: number) {
    const nos = state.tanks[0].level;
    if (nos <= 0 || state.rng() > nos * 12 * dt) return;
    const side = state.rng() < 0.5 ? -1 : 1;
    state.particles.push({
        x: state.rocket.x + side * 3,
        alt: 320 + state.rng() * 120,
        vx: side * (8 + state.rng() * 10),
        valt: 20 + state.rng() * 50,
        life: 0,
        maxLife: 1 + state.rng() * 1.2,
        size: 1,
        kind: "smoke",
    });
}

function spawnFuel(state: GameState) {
    if (!state.rocket.burning || state.phaseTime < state.nextFuelTime) return;
    state.entities.push({
        kind: "fuel", x: 20 + state.rng() * (VIEW_W - 40), alt: state.rocket.alt + SPAWN_AHEAD_FT, vx: 0, valt: 0,
        w: 7, h: 9, t: 0, dead: false, param: 0,
    });
    state.fuelSpawned += 1;
    state.nextFuelTime += FUEL_INTERVAL_S + state.fuelSpawned * FUEL_INTERVAL_GROWTH_S;
}

function pickKind(state: GameState, alt: number): EntityKind {
    const table: Array<[EntityKind, number]> = [
        ["packet", 3],
        ["bird", alt < 9000 ? 4 : 0],
        ["balloon", alt > 6000 && alt < 120000 ? 2 : 0],
        ["jet", alt > 18000 && alt < 80000 ? 2 : 0],
        ["junk", alt > 85000 ? 3 : 0],
        ["gust", alt > 5000 && alt < 44000 ? 1.2 : 0],
    ];
    const total = table.reduce((sum, [, w]) => sum + w, 0);
    let r = state.rng() * total;
    for (const [kind, w] of table) {
        r -= w;
        if (r <= 0) return kind;
    }
    return "packet";
}

function spawnEntities(state: GameState) {
    const rocket = state.rocket;
    const rng = state.rng;

    while (state.nextCloudAlt < rocket.alt + SPAWN_AHEAD_FT && state.nextCloudAlt < 32000) {
        state.entities.push({
            kind: "cloud", x: rng() * VIEW_W, alt: state.nextCloudAlt, vx: (rng() - 0.5) * 6, valt: 0,
            w: 0, h: 0, t: 0, dead: false, param: Math.floor(rng() * 3),
        });
        state.nextCloudAlt += 1000 + rng() * 1800;
    }

    spawnFuel(state);

    while (state.nextSpawnAlt < rocket.alt + SPAWN_AHEAD_FT + LOOKAHEAD_FT) {
        const alt = state.nextSpawnAlt;
        const kind = pickKind(state, alt);
        const fromLeft = rng() < 0.5;
        const base: Entity = { kind, x: 10 + rng() * (VIEW_W - 20), alt, vx: 0, valt: 0, w: 5, h: 5, t: rng() * 10, dead: false, param: 0 };
        switch (kind) {
            case "bird":
                base.vx = (fromLeft ? 1 : -1) * (12 + rng() * 18);
                base.w = 7;
                base.h = 4;
                break;
            case "balloon":
                base.valt = 40;
                base.vx = (rng() - 0.5) * 8;
                base.w = 7;
                base.h = 9;
                break;
            case "jet":
                base.x = fromLeft ? -30 : VIEW_W + 30;
                base.vx = (fromLeft ? 1 : -1) * (95 + rng() * 40);
                base.w = 15;
                base.h = 5;
                break;
            case "junk":
                base.x = fromLeft ? -20 : VIEW_W + 20;
                base.vx = (fromLeft ? 1 : -1) * (40 + rng() * 40);
                base.w = 7;
                base.h = 3;
                break;
            case "gust":
                base.x = VIEW_W / 2;
                base.param = (fromLeft ? 1 : -1) * (45 + rng() * 35);
                base.w = VIEW_W;
                base.h = 36;
                break;
            case "packet":
            case "fuel":
            case "cloud":
                break;
        }
        state.entities.push(base);
        // Denser up high where the rocket moves faster
        state.nextSpawnAlt += 560 + rng() * 520 + Math.min(Math.max(0, alt - SPAWN_AHEAD_FT), 60000) * 0.012;
    }
}

function updateEntities(state: GameState, dt: number) {
    const rocket = state.rocket;
    const rocketTop = ROCKET_Y - ROCKET_H + 3;

    for (const e of state.entities) {
        if (isDormant(e, rocket.alt)) continue;
        e.t += dt;
        e.x += e.vx * dt;
        e.alt += e.valt * dt;

        const sy = toScreenY(e.alt, rocket.alt);
        if (sy > VIEW_H + 80 || e.x < -80 || e.x > VIEW_W + 80) {
            e.dead = true;
            continue;
        }
        if (e.kind == "cloud" || e.kind == "gust" || state.phase != "flight") continue;

        const overlapX = Math.abs(e.x - rocket.x) < e.w / 2 + 2.5;
        const overlapY = sy + e.h / 2 > rocketTop && sy - e.h / 2 < ROCKET_Y - 4;
        if (!overlapX || !overlapY) continue;

        if (e.kind == "packet") {
            e.dead = true;
            state.packets += 1;
            state.sounds.push("pickup");
            for (let i = 0; i < 8; i++) {
                state.particles.push({
                    x: e.x, alt: e.alt, vx: (state.rng() - 0.5) * 60, valt: rocket.vel + (state.rng() - 0.5) * 800,
                    life: 0, maxLife: 0.4, size: 1, kind: "spark",
                });
            }
        } else if (e.kind == "fuel") {
            e.dead = true;
            rocket.prop = Math.min(1, rocket.prop + FUEL_PER_PICKUP);
            state.sounds.push("refuel");
            if (!rocket.burning) {
                rocket.burning = true;
                state.sounds.push("ignite");
                callout(state, "RELIGHT!");
            }
        } else {
            // One vehicle, no spares
            const reasons: Record<string, string> = {
                bird: "BIRD STRIKE", balloon: "BALLOON STRIKE", jet: "MID-AIR COLLISION", junk: "SPACE JUNK STRIKE",
            };
            rapidUnscheduledDisassembly(state, reasons[e.kind] ?? "VEHICLE LOST");
            return;
        }
    }
    state.entities = state.entities.filter((e) => !e.dead);
}

function updateParticles(state: GameState, dt: number) {
    for (const p of state.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.alt += p.valt * dt;
        if (p.kind == "smoke") {
            p.vx *= 1 - Math.min(1, dt * 1.5);
            p.valt *= 1 - Math.min(1, dt * 1.5);
        } else if (p.kind == "debris") {
            p.valt -= 800 * dt;
        }
    }
    state.particles = state.particles.filter((p) => p.life < p.maxLife);
    if (state.particles.length > 600) state.particles.splice(0, state.particles.length - 600);
}
