import { Redis } from "@upstash/redis";

let redis: Redis | undefined;

export function getRedis(): Redis {
    return redis ??= new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN!,
    });
}
