/**
 *  SSTA
 *  ─────
 *  Proprietary.
 *  Unauthorized disclosure, export, or use prohibited.
 *  Copyright (c) 2026 Student Space Technology Association.
 */
import { GameSound } from "./engine";

const MASTER_VOLUME = 0.12;

/* Safari 17+; not in the DOM types yet */
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/* Shown on the media card iOS puts on the lock screen and in the Dynamic Island while the game plays sound */
const MEDIA_INFO: MediaMetadataInit = {
    title: "Big Liquid: The Game",
    artist: "SSTA",
    artwork: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
};

/**
 * Tiny chiptune-style synth for the minigame; everything is generated, no assets
 */
export class Sfx {
    private readonly ctx: AudioContext;
    private readonly master: GainNode;
    private readonly noise: AudioBuffer;
    private readonly engineGain: GainNode;
    private readonly engineFilter: BiquadFilterNode;
    private muted: boolean = false;

    public constructor() {
        // iOS otherwise treats Web Audio as ambient, which the silent switch mutes
        const session = (navigator as AudioSessionNavigator).audioSession;
        if (session) session.type = "playback";
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_VOLUME;
        this.master.connect(this.ctx.destination);

        this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        // Continuous engine rumble, driven by setEngine()
        const engine = this.ctx.createBufferSource();
        engine.buffer = this.noise;
        engine.loop = true;
        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = "lowpass";
        this.engineFilter.frequency.value = 300;
        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;
        engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
        engine.start();

        if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata(MEDIA_INFO);
            // The card's play/pause button mutes, same as B
            navigator.mediaSession.setActionHandler("pause", () => this.setMuted(true));
            navigator.mediaSession.setActionHandler("play", () => this.setMuted(false));
            navigator.mediaSession.playbackState = "playing";
        }
    }

    /**
     * Resume the context; must be called from a gesture the browser accepts for audio
     */
    public unlock(): void {
        if (this.ctx.state != "running") void this.ctx.resume();
    }

    public toggleMute(): boolean {
        this.setMuted(!this.muted);
        return this.muted;
    }

    private setMuted(muted: boolean) {
        this.muted = muted;
        this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = muted ? "paused" : "playing";
    }

    /**
     * @param level 0 (off) to 1 (full throttle, thick air)
     */
    public setEngine(level: number): void {
        const now = this.ctx.currentTime;
        this.engineGain.gain.setTargetAtTime(level * 1.4, now, 0.05);
        this.engineFilter.frequency.setTargetAtTime(180 + level * 500, now, 0.05);
    }

    public play(sound: GameSound): void {
        if (this.ctx.state == "suspended") void this.ctx.resume();
        switch (sound) {
            case "blip":
                this.tone("square", 880, 880, 0.06, 0.5);
                break;
            case "fill":
                this.tone("triangle", 180 + Math.random() * 60, 120, 0.04, 0.4);
                break;
            case "refuel":
                this.tone("triangle", 300, 900, 0.18, 0.6);
                this.tone("square", 1200, 1200, 0.06, 0.35, 0.16);
                break;
            case "warn":
                this.tone("square", 1040, 1040, 0.05, 0.35);
                break;
            case "pickup":
                this.tone("square", 660, 660, 0.05, 0.45);
                this.tone("square", 990, 990, 0.05, 0.45, 0.05);
                this.tone("square", 1320, 1320, 0.08, 0.45, 0.1);
                break;
            case "meco":
                this.tone("triangle", 520, 260, 0.25, 0.7);
                break;
            case "deploy":
                this.tone("square", 520, 520, 0.08, 0.5);
                this.tone("square", 780, 780, 0.14, 0.5, 0.09);
                this.burst(0.3, 2400, 0.4);
                break;
            case "vent":
                this.burst(0.6, 3000, 0.8);
                break;
            case "ignite":
                this.burst(0.8, 900, 1);
                this.tone("sawtooth", 90, 50, 0.6, 0.6);
                break;
            case "hit":
                this.burst(0.18, 1500, 1);
                this.tone("square", 160, 60, 0.2, 0.7);
                break;
            case "explode":
                this.burst(1.6, 700, 1.4);
                this.tone("sawtooth", 120, 30, 1, 0.8);
                break;
        }
    }

    public close(): void {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.setActionHandler("pause", null);
            navigator.mediaSession.setActionHandler("play", null);
        }
        void this.ctx.close();
    }

    private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay: number = 0) {
        const start = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, start);
        osc.frequency.exponentialRampToValueAtTime(to, start + duration);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain).connect(this.master);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    private burst(duration: number, cutoff: number, volume: number) {
        const start = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = cutoff;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        src.connect(filter).connect(gain).connect(this.master);
        src.start(start);
        src.stop(start + duration + 0.02);
    }
}
