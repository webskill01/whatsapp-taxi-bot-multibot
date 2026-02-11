#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";

// --------------------------------------------------
// SET BOT DIR ARG **BEFORE** CORE IS IMPORTED
// --------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inject bot directory for core
process.argv[2] = __dirname;

// NOW import core (it will read argv[2] correctly)
await import("../../core/index.js");
