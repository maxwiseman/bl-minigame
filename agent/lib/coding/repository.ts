import { z } from "zod";

export const repository = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/).transform(value => value.toLowerCase());
