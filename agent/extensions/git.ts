import git from "eve/extensions/git";
import { nativeGitConfig } from "../lib/coding/native";

export default git({ github: nativeGitConfig() });
