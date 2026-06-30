import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const msgs = [];
page.on("console", (m) => msgs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}`));
await page.goto("http://localhost:5175/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
const found = await page.locator(".chat-page, .messages-scroll, .composer-wrap").count().catch(() => 0);
console.log("chat-elems:", found);
console.log("console:", msgs.slice(0, 25).join("\n"));
await page.screenshot({ path: "/tmp/marloues-chat-current.png", fullPage: false });
console.log("saved /tmp/marloues-chat-current.png");
await browser.close();
