import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as PaperService from "./PaperService.ts";

export const layer = PaperService.layer.pipe(Layer.provide(ProcessRunner.layer));
