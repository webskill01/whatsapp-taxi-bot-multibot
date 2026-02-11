#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import "../../core/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pass bot dir via argv (REQUIRED)
process.argv[2] = __dirname;
