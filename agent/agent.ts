import { defineAgent } from "eve";

export default defineAgent({
    build: { externalDependencies: ["@ai-sdk/harness-fx"] },
    model: "openai/gpt-6.1-sol",
});
