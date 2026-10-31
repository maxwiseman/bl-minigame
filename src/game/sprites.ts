/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */

/* Shared palette; sprite strings index into this by character ("." is transparent) */
export const PALETTE: Record<string, string> = {
    k: "#14151c",
    d: "#4b505c",
    g: "#a3a9b4",
    w: "#f4f4f0",
    o: "#ff8200",
    O: "#b85e00",
    y: "#ffd23f",
    r: "#e8402a",
    b: "#3a6fd8",
    c: "#9fe2ff",
    l: "#7cff6b",
    L: "#2f9e3a",
    t: "#d9a066",
    T: "#a8703f",
    p: "#6b4a5e",
};

/* Big Liquid: white airframe, orange bands, black interstage, external downcomer on the left */
const ROCKET = [
    "....o....",
    "....o....",
    "...wwg...",
    "...wwg...",
    "..wwwwg..",
    "..wwwwg..",
    "..wwwwg..",
    "..ooooO..",
    "..wwwwg..",
    "..wwwwg..",
    "..kkkkd..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dooooO..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dwwwwg..",
    ".dkkkkd..",
    ".dwwwwg..",
    ".dwwwwg..",
    "k.wwwwg.k",
    "kkwwwwgkk",
    "kkwwwwgkk",
    "kk.ddd.kk",
    "...ddd...",
    "..ddddd..",
];

const CHUTE = [
    "....ooowww....",
    "..ooowwwooow..",
    ".wwwooowwwooo.",
    "oowwwwoooowwww",
    "g.g...g...g.g.",
    ".g.g..g..g.g..",
    "..g.g.g.g.g...",
    "....g.g.g.....",
    ".....ggg......",
];

const BIRD = [
    [
        "k.....k",
        ".k...k.",
        "..kkk..",
        "...k...",
    ],
    [
        ".......",
        "..kkk..",
        ".k.k.k.",
        "k.....k",
    ],
];

const BALLOON = [
    "..www..",
    ".wwwwg.",
    "wwwwwgg",
    "wwwwwgg",
    ".wwwgg.",
    "..wgg..",
    "...d...",
    "...d...",
    "...d...",
    "..ddd..",
    "..dod..",
    "..ddd..",
];

const JET = [
    "..kk............",
    "..dgk...........",
    "dggggggggggggcc.",
    ".dgggggggggggggg",
    "....ddgg........",
    "......dd........",
];

const FUEL = [
    "..ddd..",
    "...d...",
    ".ooooo.",
    "ooooooO",
    "owwwwwO",
    "ooooooO",
    "owwwwwO",
    "ooooooO",
    ".OOOOO.",
];

/* Satellite fragment: solar panels either side of a bus */
const JUNK = [
    "bb.d.bb",
    "bbdgdbb",
    "bb.d.bb",
];

const PACKET = [
    [
        ".lll.",
        "lLlLl",
        "lllll",
        "lLlLl",
        ".lll.",
    ],
    [
        ".LLL.",
        "LlLlL",
        "LLLLL",
        "LlLlL",
        ".LLL.",
    ],
];

const JOSHUA_TREE = [
    "L.L.L..",
    "L.L.L..",
    "TLT.T.L",
    ".T.TT.T",
    "..TT.T.",
    "...TT..",
    "...T...",
    "...T...",
];

function build(rows: string[], flip: boolean = false): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const w = Math.max(...rows.map((r) => r.length));
    canvas.width = w;
    canvas.height = rows.length;
    const ctx = canvas.getContext("2d")!;
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const color = PALETTE[row[x]!];
            if (!color) continue;
            ctx.fillStyle = color;
            ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
        }
    });
    return canvas;
}

/**
 * Pixelated cloud built from overlapping blobs, shaded on the underside
 */
function buildCloud(seed: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    const w = 34 + seed * 8;
    const h = 14;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const blobs: Array<[number, number, number]> = [];
    for (let i = 0; i < 5 + seed; i++) {
        const t = i / (4 + seed);
        blobs.push([5 + t * (w - 10), 8 - Math.sin(t * Math.PI) * (3 + seed) + ((i * 7) % 3), 4 + ((i * 5 + seed) % 3)]);
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const inside = blobs.some(([bx, by, r]) => (x - bx) ** 2 + (y - by) ** 2 <= r * r);
            if (!inside || y > 11) continue;
            ctx.fillStyle = y > 8 ? "#c9d6e6" : "#ffffff";
            ctx.fillRect(x, y, 1, 1);
        }
    }
    return canvas;
}

export interface SpriteSheet {
    rocket: HTMLCanvasElement;
    chute: HTMLCanvasElement;
    bird: HTMLCanvasElement[];
    balloon: HTMLCanvasElement;
    jetRight: HTMLCanvasElement;
    jetLeft: HTMLCanvasElement;
    packet: HTMLCanvasElement[];
    fuel: HTMLCanvasElement[];
    junk: HTMLCanvasElement;
    joshuaTree: HTMLCanvasElement;
    clouds: HTMLCanvasElement[];
}

let sheet: SpriteSheet | null = null;

/**
 * Lazily rasterise every sprite once
 */
export function sprites(): SpriteSheet {
    if (sheet) return sheet;
    sheet = {
        rocket: build(ROCKET),
        chute: build(CHUTE),
        bird: BIRD.map((f) => build(f)),
        balloon: build(BALLOON),
        jetRight: build(JET),
        jetLeft: build(JET, true),
        packet: PACKET.map((f) => build(f)),
        // Second frame glints yellow so pickups read at a glance
        fuel: [build(FUEL), build(FUEL.map((row, i) => (i == 3 || i == 5 ? row.replace(/o/g, "y") : row)))],
        junk: build(JUNK),
        joshuaTree: build(JOSHUA_TREE),
        clouds: [0, 1, 2].map(buildCloud),
    };
    return sheet;
}

/* 3x5 bitmap font (arrows are 5 wide); rows separated by spaces */
const GLYPHS: Record<string, string> = {
    A: ".#. #.# ### #.# #.#", B: "##. #.# ##. #.# ##.", C: ".## #.. #.. #.. .##", D: "##. #.# #.# #.# ##.",
    E: "### #.. ##. #.. ###", F: "### #.. ##. #.. #..", G: ".## #.. #.# #.# .##", H: "#.# #.# ### #.# #.#",
    I: "### .#. .#. .#. ###", J: "..# ..# ..# #.# .#.", K: "#.# #.# ##. #.# #.#", L: "#.. #.. #.. #.. ###",
    M: "#.# ### ### #.# #.#", N: "##. #.# #.# #.# #.#", O: ".#. #.# #.# #.# .#.", P: "##. #.# ##. #.. #..",
    Q: ".#. #.# #.# ##. .##", R: "##. #.# ##. #.# #.#", S: ".## #.. .#. ..# ##.", T: "### .#. .#. .#. .#.",
    U: "#.# #.# #.# #.# ###", V: "#.# #.# #.# #.# .#.", W: "#.# #.# ### ### #.#", X: "#.# #.# .#. #.# #.#",
    Y: "#.# #.# .#. .#. .#.", Z: "### ..# .#. #.. ###",
    "0": "### #.# #.# #.# ###", "1": ".#. ##. .#. .#. ###", "2": "##. ..# .#. #.. ###", "3": "##. ..# .#. ..# ##.",
    "4": "#.# #.# ### ..# ..#", "5": "### #.. ##. ..# ##.", "6": ".## #.. ### #.# ###", "7": "### ..# .#. .#. .#.",
    "8": "### #.# ### #.# ###", "9": "### #.# ### ..# ##.",
    " ": "... ... ... ... ...", "-": "... ... ### ... ...", ".": "... ... ... ... .#.", ",": "... ... ... .#. #..",
    ":": "... .#. ... .#. ...", "!": ".#. .#. .#. ... .#.", "/": "..# ..# .#. #.. #..", "+": "... .#. ### .#. ...",
    "%": "#.# ..# .#. #.. #.#", "?": "##. ..# .#. ... .#.", "'": ".#. .#. ... ... ...", "=": "... ### ... ### ...",
    "(": ".#. #.. #.. #.. .#.", ")": ".#. ..# ..# ..# .#.", "x": "... #.# .#. #.# ...",
    "↑": "..#.. .###. #.#.# ..#.. ..#..", "↓": "..#.. ..#.. #.#.# .###. ..#..",
    "←": "..#.. .#... ##### .#... ..#..", "→": "..#.. ...#. ##### ...#. ..#..",
};

const glyphCache = new Map<string, boolean[][]>();

function glyph(ch: string): boolean[][] {
    const cached = glyphCache.get(ch);
    if (cached) return cached;
    const rows = (GLYPHS[ch] ?? GLYPHS["?"]!).split(" ").map((r) => [...r].map((c) => c == "#"));
    glyphCache.set(ch, rows);
    return rows;
}

/**
 * Width in pixels of a string at the given scale
 */
export function textWidth(text: string, scale: number = 1): number {
    return glyphChars(text).reduce((w, c) => w + (glyph(c)[0]!.length + 1) * scale, -scale);
}

/* Lowercase "x" is kept as a small multiplication sign; everything else is uppercased */
function glyphChars(text: string): string[] {
    return [...text].map((c) => (c == "x" ? c : c.toUpperCase()));
}

export interface TextOptions {
    scale?: number;
    color?: string;
    shadow?: string | null;
    align?: "left" | "center" | "right";
}

/**
 * Draw bitmap text
 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: TextOptions = {}): void {
    const scale = opts.scale ?? 1;
    const chars = glyphChars(text);
    const width = textWidth(text, scale);
    const cx = Math.round(opts.align == "center" ? x - width / 2 : opts.align == "right" ? x - width : x);
    const passes: Array<[string, number]> = [];
    // Half-stroke offset keeps large text legible instead of doubling every stroke
    if (opts.shadow !== null) passes.push([opts.shadow ?? PALETTE.k!, Math.max(1, Math.floor(scale / 2))]);
    passes.push([opts.color ?? PALETTE.w!, 0]);

    for (const [color, offset] of passes) {
        ctx.fillStyle = color;
        let px = cx;
        for (const c of chars) {
            const rows = glyph(c);
            rows.forEach((row, ry) => row.forEach((on, rx) => {
                if (on) ctx.fillRect(px + rx * scale + offset, Math.round(y) + ry * scale + offset, scale, scale);
            }));
            px += (rows[0]!.length + 1) * scale;
        }
    }
}
