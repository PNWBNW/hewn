import { chromium } from "playwright"; import fs from "fs";
const names = fs.readFileSync(process.argv[3]||"names50.txt","utf8").trim(); const out = process.argv[2] || "check";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args:["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } }); p.on("pageerror", e => console.log("ERR", e.message));
await p.goto(`http://localhost:8765/check.html?grid=${names}&hour=14&season=summer`); await p.waitForSelector("body[data-done]", { timeout: 1700000 });
const res = await p.evaluate(() => window.RESULTS); fs.mkdirSync(out, { recursive: true });
res.forEach((r, i) => { fs.writeFileSync(`${out}/${String(i).padStart(2,"0")}.jpg`, Buffer.from(r.thumb.split(",")[1], "base64")); delete r.thumb; });
fs.writeFileSync(`${out}/results.json`, JSON.stringify(res, null, 1)); console.log("done", res.length); await b.close();
