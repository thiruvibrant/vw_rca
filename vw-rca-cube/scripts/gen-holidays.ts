// Regenerates analytics/holidaysData.ts from analytics/holidays.csv (the shared holiday list).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const csv = fs.readFileSync(path.join(root, "analytics/holidays.csv"), "utf8");
const head = fs.readFileSync(path.join(root, "analytics/holidaysData.ts"), "utf8").split("export const HOLIDAYS_CSV")[0];
fs.writeFileSync(path.join(root, "analytics/holidaysData.ts"), `${head}export const HOLIDAYS_CSV = \`${csv}\`;\n`);
console.log("analytics/holidaysData.ts regenerated");
