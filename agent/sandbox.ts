import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";
import { installCodeTooling } from "eve/extensions/code/sandbox";
import { codingNetworkPolicy } from "./lib/coding/native";

export const environment = VercelSandbox.environment({
    prepare: sandbox => installCodeTooling(sandbox),
});

export default defineSandbox(() => environment.open({
    timeout: 20 * 60_000,
    resources: { vcpus: 2 },
    networkPolicy: codingNetworkPolicy(),
}));
