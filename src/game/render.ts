/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */
import {
    Entity, FILL_TARGET, GameState, PACKET_POINTS, RECOVERY_BONUS, RUD_PENALTY, inFillBand, isDormant, PX_PER_FT, SPAWN_AHEAD_FT, qRatio, Recovery, ROCKET_H, ROCKET_Y, Tank, toScreenY, usableLevel,
    VIEW_H, VIEW_W,
} from "./engine";
import { LEADERBOARD_SIZE, LeaderboardEntry } from "./leaderboard";
import { drawText, PALETTE, sprites, textWidth } from "./sprites";

type RGB = [number, number, number];

/* Mojave-blue at the pad fading to black near the top of the flight */
const SKY_STOPS: Array<[number, RGB]> = [
    [0, [168, 220, 255]],
    [12000, [95, 168, 238]],
    [36000, [47, 95, 192]],
    [56000, [20, 36, 106]],
    [70000, [6, 10, 38]],
    [85000, [0, 0, 6]],
];

/* Deterministic pseudo-random so scenery doesn't shimmer between frames */
function hash(n: number): number {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
}

const STARS = Array.from({ length: 80 }, (_, i) => ({ x: hash(i) * VIEW_W, y: hash(i + 100) * VIEW_H, phase: hash(i + 200) * 6 }));
const FAR_RIDGE = Array.from({ length: VIEW_W }, (_, x) => 14 + Math.sin(x * 0.045) * 6 + Math.sin(x * 0.13 + 1) * 3 + Math.sin(x * 0.31) * 1.5);
const NEAR_RIDGE = Array.from({ length: VIEW_W }, (_, x) => 7 + Math.sin(x * 0.07 + 2) * 4 + Math.sin(x * 0.21) * 2);

function skyColor(alt: number): string {
    let i = 0;
    while (i < SKY_STOPS.length - 2 && alt > SKY_STOPS[i + 1]![0]) i++;
    const [a0, c0] = SKY_STOPS[i]!;
    const [a1, c1] = SKY_STOPS[i + 1]!;
    const t = Math.max(0, Math.min(1, (alt - a0) / (a1 - a0)));
    // Quantise for a deliberate banded, palette-limited look
    const ch = (k: number) => Math.round((c0[k]! + (c1[k]! - c0[k]!) * t) / 8) * 8;
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
}

/* How long before a jet comes on screen to start flashing its warning */
const JET_WARN_S = 1.5;

/**
 * Flash a "!" on the side a jet will come in from, until it's on screen
 */
function drawJetWarning(ctx: CanvasRenderingContext2D, e: Entity, y: number, state: GameState) {
    const fromLeft = e.vx > 0;
    if (fromLeft ? e.x > 0 : e.x < VIEW_W) return;
    const rocket = state.rocket;
    if (isDormant(e, rocket.alt)) {
        // Time until it wakes, plus the stretch it then flies before reaching the edge
        const climb = rocket.vel * state.speed;
        if (climb <= 0) return;
        const wake = (e.alt - rocket.alt - SPAWN_AHEAD_FT) / climb;
        if (wake + Math.abs(e.x - (fromLeft ? 0 : VIEW_W)) / Math.abs(e.vx) > JET_WARN_S) return;
    }
    if (!blink(state, 4)) return;
    // Clear of the HUD and the gauges on the left
    const row = Math.max(24, Math.min(VIEW_H - 10, y - 2));
    drawText(ctx, "!", fromLeft ? 28 : VIEW_W - 6, row, { color: PALETTE.r! });
}

function blink(state: GameState, hz: number = 2): boolean {
    return Math.floor(state.time * hz * 2) % 2 == 0;
}

/**
 * Render one frame of the game
 */
/* Button names used in on-screen hints */
const KEY_NAMES = {
    keyboard: { action: "SPACE", mute: "M", entry: "TYPE NAME - ENTER TO SAVE" },
    touch: { action: "A", mute: "B", entry: "↑↓ LETTER ←→ MOVE B DEL A OK" },
};
export type Controls = keyof typeof KEY_NAMES;
let keys = KEY_NAMES.keyboard;

/**
 * @param controls which button names the hints should use
 */
export function render(ctx: CanvasRenderingContext2D, state: GameState, controls: Controls = "keyboard"): void {
    keys = KEY_NAMES[controls];
    const cam = state.rocket.alt;
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    if (state.shake > 0) {
        const m = state.shake * 2;
        ctx.translate(Math.round((Math.random() - 0.5) * m), Math.round((Math.random() - 0.5) * m));
    }
    drawSky(ctx, cam, state);
    drawScenery(ctx, cam, state);
    const clouds = state.entities.filter((e) => e.kind == "cloud");
    clouds.filter((e) => !cloudInFront(e)).forEach((e) => drawEntity(ctx, e, cam, state));
    state.entities.filter((e) => e.kind != "cloud").forEach((e) => drawEntity(ctx, e, cam, state));
    drawParticles(ctx, state, cam, true);
    drawRocket(ctx, state);
    drawParticles(ctx, state, cam, false);
    ctx.globalAlpha = 0.8;
    clouds.filter(cloudInFront).forEach((e) => drawEntity(ctx, e, cam, state));
    ctx.globalAlpha = 1;
    ctx.restore();

    switch (state.phase) {
        case "title":
            drawTitle(ctx, state);
            break;
        case "fill":
            drawFill(ctx, state);
            break;
        case "countdown":
            drawCountdown(ctx, state);
            break;
        case "flight":
        case "descent":
            drawHud(ctx, state);
            break;
        case "rud":
            break;
        case "result":
            drawResult(ctx, state);
            break;
    }

    if (state.callout) {
        const rise = Math.min(1, state.callout.time * 6);
        drawText(ctx, state.callout.text, VIEW_W / 2, 64 - rise * 6, { scale: 2, color: PALETTE.y!, align: "center" });
    }
}

function cloudInFront(e: Entity): boolean {
    return Math.floor(e.alt) % 3 == 0;
}

function drawSky(ctx: CanvasRenderingContext2D, cam: number, state: GameState) {
    for (let y = 0; y < VIEW_H; y += 4) {
        ctx.fillStyle = skyColor(cam + (ROCKET_Y - y) / PX_PER_FT);
        ctx.fillRect(0, y, VIEW_W, 4);
    }
    const starAlpha = Math.max(0, Math.min(1, (cam - 44000) / 24000));
    if (starAlpha <= 0) return;
    const drift = cam * PX_PER_FT * 0.05;
    for (const s of STARS) {
        const twinkle = Math.sin(state.time * 3 + s.phase) > -0.6;
        if (!twinkle) continue;
        ctx.globalAlpha = starAlpha;
        ctx.fillStyle = s.phase > 5 ? PALETTE.c! : "#ffffff";
        ctx.fillRect(Math.round(s.x), Math.round((s.y + drift) % VIEW_H), 1, 1);
    }
    ctx.globalAlpha = 1;
}

function drawScenery(ctx: CanvasRenderingContext2D, cam: number, state: GameState) {
    const lift = cam * PX_PER_FT;
    if (lift > VIEW_H + 60) return;
    const s = sprites();

    // Distant ridges move a little slower than the pad for a bit of parallax
    const farBase = ROCKET_Y - 6 + lift * 0.8;
    const nearBase = ROCKET_Y - 2 + lift * 0.9;
    for (let x = 0; x < VIEW_W; x++) {
        ctx.fillStyle = "#b48a9a";
        ctx.fillRect(x, Math.round(farBase - FAR_RIDGE[x]!), 1, VIEW_H);
    }
    for (let x = 0; x < VIEW_W; x++) {
        ctx.fillStyle = PALETTE.p!;
        ctx.fillRect(x, Math.round(nearBase - NEAR_RIDGE[x]!), 1, VIEW_H);
    }

    const gy = Math.round(toScreenY(0, cam));
    if (gy > VIEW_H + 50) return;

    // Desert floor
    ctx.fillStyle = PALETTE.t!;
    ctx.fillRect(0, gy, VIEW_W, VIEW_H - gy + 10);
    ctx.fillStyle = PALETTE.T!;
    for (let i = 0; i < 70; i++) ctx.fillRect(Math.floor(hash(i + 300) * VIEW_W), gy + 2 + Math.floor(hash(i + 400) * 40), hash(i) > 0.7 ? 2 : 1, 1);

    // Joshua trees
    for (const tx of [14, 40, 132, 158]) ctx.drawImage(s.joshuaTree, tx, gy - 7);

    // Blockhouse with a beacon
    ctx.fillStyle = PALETTE.d!;
    ctx.fillRect(56, gy - 6, 14, 6);
    ctx.fillStyle = PALETTE.g!;
    ctx.fillRect(55, gy - 7, 16, 1);
    ctx.fillStyle = PALETTE.k!;
    ctx.fillRect(59, gy - 4, 3, 2);
    if (blink(state, 1)) {
        ctx.fillStyle = PALETTE.r!;
        ctx.fillRect(62, gy - 9, 1, 2);
    }

    // Pad and launch tower
    const padX = VIEW_W / 2;
    ctx.fillStyle = PALETTE.g!;
    ctx.fillRect(padX - 12, gy, 24, 2);
    ctx.fillStyle = PALETTE.d!;
    ctx.fillRect(padX - 12, gy + 2, 24, 1);

    const towerX = padX + 8;
    const towerH = 46;
    ctx.fillStyle = PALETTE.d!;
    ctx.fillRect(towerX, gy - towerH, 1, towerH);
    ctx.fillRect(towerX + 4, gy - towerH, 1, towerH);
    for (let y = 0; y < towerH; y += 4) {
        ctx.fillRect(towerX, gy - y - 1, 5, 1);
        ctx.fillRect(towerX + 1 + ((y / 4) % 2 == 0 ? 0 : 2), gy - y - 3, 1, 1);
        ctx.fillRect(towerX + 2, gy - y - 2, 1, 1);
        ctx.fillRect(towerX + 3 - ((y / 4) % 2 == 0 ? 0 : 2), gy - y - 3, 1, 1);
    }
    ctx.fillStyle = PALETTE.r!;
    ctx.fillRect(towerX + 2, gy - towerH - 1, 1, 1);

    // Fill umbilical stays attached until liftoff
    if (state.phase == "title" || state.phase == "fill" || state.phase == "countdown") {
        ctx.fillStyle = PALETTE.k!;
        ctx.fillRect(padX + 3, gy - 22, towerX - padX - 3, 1);
        ctx.fillRect(padX + 3, gy - 21, 1, 1);
    }
}

function drawRocket(ctx: CanvasRenderingContext2D, state: GameState) {
    const rocket = state.rocket;
    if (state.phase == "rud" || (state.phase == "result" && state.failure)) return;
    const s = sprites();
    const dx = Math.round(rocket.x) - 4;
    const dy = ROCKET_Y - ROCKET_H;
    const shear = (row: number) => Math.round((ROCKET_H - 1 - row) * rocket.tilt * 0.14);

    if (rocket.burning) drawFlame(ctx, state, dx + 4, shear);

    for (let row = 0; row < ROCKET_H; row++) {
        ctx.drawImage(s.rocket, 0, row, s.rocket.width, 1, dx + shear(row), dy + row, s.rocket.width, 1);
    }

    if (rocket.chute) {
        const top = dy + shear(0);
        ctx.drawImage(s.chute, dx + shear(0) - 2, top - 13 + Math.round(Math.sin(state.time * 3)));
        ctx.fillStyle = PALETTE.g!;
        ctx.fillRect(dx + shear(0) + 4, top - 4, 1, 4);
    }
}

function drawFlame(ctx: CanvasRenderingContext2D, state: GameState, cx: number, shear: (row: number) => number) {
    const rocket = state.rocket;
    const flicker = 0.85 + Math.random() * 0.3;
    const len = Math.round((8 + 16 * rocket.throttle) * flicker);
    // Plume balloons out as ambient pressure drops; shock diamonds only show in thick air
    const expand = Math.min(4, rocket.alt / 18000);
    const diamonds = rocket.alt < 32000;
    for (let i = 0; i < len; i++) {
        const frac = i / len;
        const row = ROCKET_H + i;
        let hw = Math.round(1 + frac * (1.5 + expand));
        const isDiamond = diamonds && i > 1 && i % 4 == 3;
        if (diamonds && i % 4 == 1) hw = Math.max(1, hw - 1);
        ctx.fillStyle = frac < 0.15 ? "#ffffff" : frac < 0.4 ? PALETTE.y! : frac < 0.75 ? PALETTE.o! : PALETTE.r!;
        ctx.globalAlpha = expand > 2 && frac > 0.5 ? 0.7 : 1;
        const x = cx + shear(row);
        ctx.fillRect(x - hw, ROCKET_Y + i, hw * 2 + 1, 1);
        if (isDiamond) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x, ROCKET_Y + i, 1, 1);
        }
    }
    ctx.globalAlpha = 1;
}

function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, cam: number, state: GameState) {
    const s = sprites();
    const x = Math.round(e.x);
    const y = Math.round(toScreenY(e.alt, cam));
    if (e.kind == "jet") drawJetWarning(ctx, e, y, state);
    if (isDormant(e, state.rocket.alt) || y < -40 || y > VIEW_H + 40) return;

    switch (e.kind) {
        case "bird":
            ctx.drawImage(s.bird[Math.floor(e.t * 6) % 2]!, x - 3, y - 2);
            break;
        case "balloon":
            ctx.drawImage(s.balloon, x - 3, y - 6);
            break;
        case "packet":
            ctx.drawImage(s.packet[Math.floor(e.t * 4) % 2]!, x - 2, y - 2);
            break;
        case "fuel":
            ctx.drawImage(s.fuel[Math.floor(e.t * 5) % 2]!, x - 3, y - 4);
            break;
        case "junk":
            ctx.drawImage(s.junk, x - 3, y - 1);
            break;
        case "jet": {
            const right = e.vx > 0;
            ctx.drawImage(right ? s.jetRight : s.jetLeft, x - 8, y - 3);
            // Contrail
            for (let k = 0; k < 6; k++) {
                ctx.globalAlpha = 0.5 - k * 0.08;
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(right ? x - 8 - (k + 1) * 10 : x + 8 + k * 10, y, 10, 1);
            }
            ctx.globalAlpha = 1;
            break;
        }
        case "gust":
            ctx.fillStyle = "rgba(255,255,255,0.45)";
            for (let k = 0; k < 7; k++) {
                const span = VIEW_W + 40;
                const travel = (((e.t * e.param * 1.6 + hash(k + e.alt) * span) % span) + span) % span - 20;
                ctx.fillRect(Math.round(travel), Math.round(y - e.h / 2 + 3 + k * 5), 8 + Math.round(hash(k) * 10), 1);
            }
            break;
        case "cloud": {
            const c = s.clouds[e.param]!;
            ctx.drawImage(c, x - Math.floor(c.width / 2), y - Math.floor(c.height / 2));
            break;
        }
    }
}

function drawParticles(ctx: CanvasRenderingContext2D, state: GameState, cam: number, smoke: boolean) {
    for (const p of state.particles) {
        if ((p.kind == "smoke") != smoke) continue;
        const frac = p.life / p.maxLife;
        const y = toScreenY(p.alt, cam);
        if (y < -10 || y > VIEW_H + 10) continue;
        let size = p.size;
        switch (p.kind) {
            case "smoke": {
                size = Math.round(p.size + frac * 5);
                const shade = Math.round(240 - frac * 80);
                ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
                ctx.globalAlpha = (1 - frac) * 0.8;
                break;
            }
            case "fire":
                size = 2;
                ctx.fillStyle = frac < 0.3 ? PALETTE.y! : frac < 0.6 ? PALETTE.o! : PALETTE.r!;
                break;
            case "spark":
                ctx.fillStyle = PALETTE.l!;
                break;
            case "debris":
                ctx.fillStyle = frac < 0.5 ? PALETTE.w! : PALETTE.d!;
                size = 2;
                break;
        }
        ctx.fillRect(Math.round(p.x - size / 2), Math.round(y - size / 2), size, size);
        ctx.globalAlpha = 1;
    }
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = "rgba(14,16,26,0.86)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PALETTE.o!;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
}

function drawTitle(ctx: CanvasRenderingContext2D, state: GameState) {
    const cx = VIEW_W / 2;
    drawText(ctx, "BIG", cx, 22, { scale: 4, color: PALETTE.o!, shadow: "#4a2200", align: "center" });
    drawText(ctx, "LIQUID", cx, 46, { scale: 4, color: PALETTE.o!, shadow: "#4a2200", align: "center" });
    drawText(ctx, "SSTA FLAGSHIP LIQUID ROCKET", cx, 72, { color: PALETTE.w!, align: "center" });

    if (blink(state, 1.5)) drawText(ctx, `PRESS ${keys.action} TO LOAD`, cx, 92, { color: PALETTE.y!, align: "center" });
    if (state.best > 0) drawText(ctx, `BEST ${fmt(state.best)}`, cx, 102, { color: PALETTE.c!, align: "center" });
    const leader = state.board?.[0];
    if (leader) drawText(ctx, `LEADER ${leader.name} ${fmt(leader.score)}`, cx, 110, { color: PALETTE.l!, align: "center" });

    const lines = ["↑↓ THROTTLE", "←→ STEER", `${keys.action} CHUTE`, `${keys.mute} MUTE`];
    lines.forEach((l, i) => drawText(ctx, l, 8, 118 + i * 8, { color: PALETTE.w! }));
}

function tankStatus(tank: Tank, active: boolean): [string, string] {
    if (!tank.locked) return active ? ["HOLD", PALETTE.y!] : ["", PALETTE.w!];
    if (tank.vented) return ["VENT", PALETTE.r!];
    if (inFillBand(tank.level)) return ["GOOD", PALETTE.l!];
    return tank.level < FILL_TARGET[0] ? ["LOW", PALETTE.y!] : ["HIGH", PALETTE.y!];
}

function drawFill(ctx: CanvasRenderingContext2D, state: GameState) {
    panel(ctx, 28, 24, 124, 132);
    drawText(ctx, "PROPELLANT LOAD", VIEW_W / 2, 30, { color: PALETTE.o!, align: "center" });

    const top = 42;
    const h = 72;
    state.tanks.forEach((tank, i) => {
        const x = i == 0 ? 56 : 108;
        ctx.fillStyle = PALETTE.k!;
        ctx.fillRect(x - 1, top - 1, 18, h + 2);
        ctx.fillStyle = PALETTE.d!;
        ctx.fillRect(x, top, 16, h);
        // Target band
        const bandTop = top + h - FILL_TARGET[1] * h;
        const bandH = (FILL_TARGET[1] - FILL_TARGET[0]) * h;
        ctx.fillStyle = "rgba(124,255,107,0.35)";
        ctx.fillRect(x, Math.round(bandTop), 16, Math.round(bandH));
        // Liquid
        const lh = Math.round(Math.min(1, tank.level) * h);
        ctx.fillStyle = i == 0 ? PALETTE.c! : PALETTE.w!;
        ctx.fillRect(x, top + h - lh, 16, lh);
        if (lh > 0) {
            ctx.fillStyle = i == 0 ? "#ffffff" : PALETTE.g!;
            ctx.fillRect(x + ((Math.floor(state.time * 10) + i * 5) % 14), top + h - lh, 2, 1);
        }
        ctx.fillStyle = PALETTE.l!;
        ctx.fillRect(x - 3, Math.round(bandTop), 2, Math.round(bandH));
        ctx.fillRect(x + 17, Math.round(bandTop), 2, Math.round(bandH));

        drawText(ctx, tank.name, x + 8, top + h + 5, { align: "center" });
        const [label, color] = tankStatus(tank, state.fillStarted && i == state.activeTank);
        if (label && (tank.locked || blink(state, 2))) drawText(ctx, label, x + 8, top + h + 13, { color, align: "center" });
    });

    if (!state.fillStarted) {
        drawText(ctx, `PRESS AND HOLD ${keys.action}`, VIEW_W / 2, 128, { color: PALETTE.w!, align: "center" });
        drawText(ctx, "LET GO IN THE GREEN BAND", VIEW_W / 2, 135, { color: PALETTE.w!, align: "center" });
        if (blink(state, 1.5)) drawText(ctx, `PRESS ${keys.action} TO BEGIN`, VIEW_W / 2, 146, { color: PALETTE.y!, align: "center" });
    } else if (state.activeTank >= state.tanks.length) {
        const load = Math.max(0, Math.min(usableLevel(state.tanks[0].level), usableLevel(state.tanks[1].level)));
        drawText(ctx, `USABLE LOAD ${Math.round(load * 100)}%`, VIEW_W / 2, 146, { color: PALETTE.w!, align: "center" });
    } else {
        drawText(ctx, `PRESS AND HOLD ${keys.action}`, VIEW_W / 2, 140, { color: PALETTE.g!, align: "center" });
        drawText(ctx, "LET GO IN THE GREEN BAND", VIEW_W / 2, 147, { color: PALETTE.g!, align: "center" });
    }
}

function drawCountdown(ctx: CanvasRenderingContext2D, state: GameState) {
    const n = Math.max(1, 3 - Math.floor(state.phaseTime));
    drawText(ctx, `T-${n}`, VIEW_W / 2, 50, { scale: 4, color: PALETTE.w!, align: "center" });
}

function gauge(ctx: CanvasRenderingContext2D, x: number, label: string, value: number, color: string, mark: number | null) {
    const top = 24;
    const h = 56;
    ctx.fillStyle = "rgba(14,16,26,0.7)";
    ctx.fillRect(x - 1, top - 1, 6, h + 2);
    const fh = Math.round(Math.max(0, Math.min(1, value)) * h);
    ctx.fillStyle = color;
    ctx.fillRect(x, top + h - fh, 4, fh);
    if (mark != null) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - 1, Math.round(top + h - mark * h), 6, 1);
    }
    drawText(ctx, label, x + 2, top + h + 3, { align: "center" });
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState) {
    const rocket = state.rocket;
    const s = sprites();

    ctx.fillStyle = "rgba(14,16,26,0.6)";
    ctx.fillRect(0, 0, VIEW_W, 11);
    drawText(ctx, `ALT ${fmt(rocket.alt)} FT`, 3, 3, { shadow: null });
    drawText(ctx, `${fmt(rocket.vel * state.speed)} FT/S`, VIEW_W - 3, 3, { shadow: null, align: "right" });

    ctx.drawImage(s.packet[0]!, 3, 14);
    drawText(ctx, `x${state.packets}`, 10, 14);
    if (state.speed > 1) drawText(ctx, `SPEED x${state.speed.toFixed(2)}`, VIEW_W - 3, 14, { color: PALETTE.c!, align: "right" });

    const q = qRatio(rocket);
    const qColor = q > 1 ? (blink(state, 4) ? PALETTE.r! : PALETTE.y!) : q > 0.8 ? PALETTE.y! : PALETTE.l!;
    gauge(ctx, 4, "P", rocket.prop, PALETTE.o!, null);
    gauge(ctx, 12, "T", rocket.throttle, PALETTE.c!, null);
    gauge(ctx, 20, "Q", q / 1.3, qColor, 1 / 1.3);

    if (rocket.stress > 0.02) {
        ctx.globalAlpha = Math.min(0.8, rocket.stress) * (blink(state, 3) ? 1 : 0.5);
        ctx.fillStyle = PALETTE.r!;
        ctx.fillRect(0, 0, VIEW_W, 2);
        ctx.fillRect(0, VIEW_H - 2, VIEW_W, 2);
        ctx.fillRect(0, 0, 2, VIEW_H);
        ctx.fillRect(VIEW_W - 2, 0, 2, VIEW_H);
        ctx.globalAlpha = 1;
    }

    if (state.phase != "flight") return;
    if (q > 0.9 && rocket.burning) {
        if (blink(state, 3)) drawText(ctx, "THROTTLE DOWN!", VIEW_W / 2, 36, { color: q > 1 ? PALETTE.r! : PALETTE.y!, align: "center" });
    } else if (!rocket.burning) {
        if (blink(state, 2)) drawText(ctx, `${keys.action} AT APOGEE`, VIEW_W / 2, 36, { color: PALETTE.y!, align: "center" });
    } else if (state.phaseTime < 6) {
        drawText(ctx, "↑↓ THROTTLE  ←→ STEER", VIEW_W / 2, 36, { align: "center" });
        drawText(ctx, "WATCH Q, GRAB DATA + FUEL", VIEW_W / 2, 44, { color: PALETTE.l!, align: "center" });
    }
}

const RECOVERY_LABEL: Record<Recovery, string> = {
    none: "NONE",
    perfect: "PERFECT",
    good: "GOOD",
    zipper: "ZIPPERED",
    ballistic: "BALLISTIC",
};

function drawResult(ctx: CanvasRenderingContext2D, state: GameState) {
    panel(ctx, 8, 6, 164, 228);
    const cx = VIEW_W / 2;
    const left = 16;
    const right = 164;
    let y = 13;

    if (state.failure) {
        drawText(ctx, "RUD!", cx, y, { scale: 2, color: PALETTE.r!, align: "center" });
        y += 13;
        drawText(ctx, state.failure, cx, y, { color: PALETTE.y!, align: "center" });
        y += 10;
    } else {
        drawText(ctx, "FLIGHT REPORT", cx, y, { scale: 2, color: PALETTE.o!, align: "center" });
        y += 16;
    }

    const row = (label: string, value: string, color: string = PALETTE.w!) => {
        drawText(ctx, label, left, y, { color: PALETTE.g! });
        drawText(ctx, value, right, y, { color, align: "right" });
        y += 9;
    };
    row("APOGEE", `${fmt(state.apogee)} FT`);
    row("DATA PACKETS", `${state.packets} x${PACKET_POINTS}`, PALETTE.l!);
    if (state.failure) {
        row("RUD PENALTY", `-${RUD_PENALTY * 100}%`, PALETTE.r!);
    } else {
        const label = RECOVERY_LABEL[state.recovery];
        const bonus = RECOVERY_BONUS[state.recovery];
        row("RECOVERY", bonus > 0 ? `${label} +${fmt(bonus)}` : label, bonus > 0 ? PALETTE.l! : PALETTE.r!);
    }

    y += 3;
    ctx.fillStyle = PALETTE.d!;
    ctx.fillRect(left, y - 3, right - left, 1);
    drawText(ctx, "SCORE", left, y + 2, { color: PALETTE.g! });
    drawText(ctx, fmt(state.score), right, y, { scale: 2, color: PALETTE.y!, align: "right" });
    y += 13;
    drawText(ctx, `BEST ${fmt(state.best)}`, right, y, { color: PALETTE.c!, align: "right" });
    if (state.newBest && blink(state, 3)) drawText(ctx, "NEW BEST!", left, y, { color: PALETTE.o! });
    y += 11;

    // Rule either side of the heading
    const half = textWidth("LEADERBOARD") / 2 + 4;
    ctx.fillStyle = PALETTE.d!;
    ctx.fillRect(left, y + 2, cx - half - left, 1);
    ctx.fillRect(cx + half, y + 2, right - cx - half, 1);
    drawText(ctx, "LEADERBOARD", cx, y, { color: PALETTE.o!, align: "center" });
    y += 9;
    drawLeaderboard(ctx, state, left, right, y);

    if (state.entry) {
        if (blink(state, 2)) drawText(ctx, "NEW HIGH SCORE!", cx, 204, { color: PALETTE.o!, align: "center" });
        drawText(ctx, keys.entry, cx, 213, { color: PALETTE.g!, align: "center" });
    } else if (state.phaseTime > 0.8 && blink(state, 1.5)) {
        drawText(ctx, `${keys.action} TO FLY AGAIN`, cx, 222, { color: PALETTE.y!, align: "center" });
    }
}

/* Top scores, with the player's row (or the name they're typing) highlighted */
function drawLeaderboard(ctx: CanvasRenderingContext2D, state: GameState, left: number, right: number, y: number) {
    const cx = VIEW_W / 2;
    if (!state.board) {
        const text = state.boardOffline ? "LEADERBOARD OFFLINE" : "LOADING...";
        drawText(ctx, text, cx, y + 4, { color: PALETTE.g!, align: "center" });
        return;
    }

    type Row = LeaderboardEntry & { mine: boolean };
    let rows: Row[] = state.board.map((e) => ({ ...e, mine: false }));
    const entry = state.entry;
    if (entry) {
        rows.push({ name: entry.chars.join(""), score: state.score, mine: true });
        // Ties go to the existing score, matching the server's order
        rows = rows.sort((a, b) => b.score - a.score || Number(a.mine) - Number(b.mine)).slice(0, LEADERBOARD_SIZE);
    } else if (state.submitted) {
        const own = rows.findIndex((r) => r.name == state.submitted!.name && r.score == state.submitted!.score);
        if (own >= 0) rows[own]!.mine = true;
    }
    if (rows.length == 0) {
        drawText(ctx, "NO SCORES YET", cx, y + 4, { color: PALETTE.g!, align: "center" });
        return;
    }

    const nameX = left + 14;
    rows.forEach((r, i) => {
        const ry = y + i * 8;
        const color = r.mine ? PALETTE.y! : PALETTE.w!;
        if (r.mine) {
            ctx.fillStyle = "rgba(255,210,63,0.12)";
            ctx.fillRect(left - 2, ry - 2, right - left + 4, 9);
        }
        drawText(ctx, String(i + 1), left + 8, ry, { color: PALETTE.g!, align: "right" });
        drawText(ctx, r.name, nameX, ry, { color });
        drawText(ctx, fmt(r.score), right, ry, { color, align: "right" });
        if (r.mine && entry && blink(state, 3)) {
            const before = entry.chars.slice(0, entry.cursor).join("");
            const cursorX = nameX + (before ? textWidth(before) + 1 : 0);
            ctx.fillStyle = PALETTE.y!;
            ctx.fillRect(cursorX, ry + 6, 3, 1);
        }
    });
}
