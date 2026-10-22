import { createPaperEnvironmentAtoms } from "@t3tools/client-runtime/state/paper";

import { connectionAtomRuntime } from "../connection/runtime";

export const paperEnvironment = createPaperEnvironmentAtoms(connectionAtomRuntime);
