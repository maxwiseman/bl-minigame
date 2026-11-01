"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker (production only, so dev builds never get cached)
 */
export default function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV != "production" || !("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("/sw.js").catch(() => {
            // Offline play is a bonus; the game works without it
        });
    }, []);
    return null;
}
