import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, expect as browserExpect, chromium, expect } from "@playwright/test";
import { entry, fixture, session } from "./fixtures.ts";
import { startTrajectoryServer } from "./index.ts";

async function smoke(): Promise<void> {
	const { root, parent, dir } = await fixture();
	const childDir = join(root, "delegation", "test", "parent");
	await mkdir(childDir, { recursive: true });
	await writeFile(
		join(childDir, "child.jsonl"),
		session("child", "/project", [
			entry("child-u1", null, "message", {
				message: { role: "user", content: "Child review task" },
			}),
		]),
	);
	const viewer = await startTrajectoryServer({ agentDir: root, sessionDir: dir });
	let browser: Browser | undefined;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(viewer.urlForSession(parent));
		await browserExpect(page.locator("#title")).toHaveText("Find promotion availability");
		await browserExpect(page.locator(".entry")).toHaveCount(6);
		await browserExpect(page.locator('[data-entry-id="abandoned"]')).toHaveCount(0);
		await page.locator("#branch").selectOption("all");
		await browserExpect(page.locator(".entry")).toHaveCount(7);
		await page.locator("#search").fill("promotion: available");
		await browserExpect(page.locator(".entry")).toHaveCount(1);
		await page.locator("#search").fill("");
		await page.locator("#kind").selectOption("toolCall");
		await browserExpect(page.locator(".entry")).toHaveCount(1);
		await page.locator("#kind").selectOption("all");
		await page.locator("#tool").selectOption("read");
		await browserExpect(page.locator(".entry")).toHaveCount(2);
		await page.locator("#tool").selectOption("");
		await page.locator("#errors").check();
		await browserExpect(page.locator(".entry")).toHaveCount(0);
		await page.locator("#errors").uncheck();
		await page.locator("#relations button").click();
		await browserExpect(page.locator("#title")).toHaveText("Child review task");
		await page.locator("#relations button").click();
		await browserExpect(page.locator("#title")).toHaveText("Find promotion availability");
		await page.locator("#branch").selectOption("latest");
		await page.getByText("Thinking · returned by model", { exact: true }).click();
		await browserExpect(page.locator("details[open]")).toHaveCount(1);
		await appendFile(
			parent,
			`${JSON.stringify(entry("u3", "a2", "message", { message: { role: "user", content: "<script>window.TRAJECTORY_XSS = true</script>Live appended prompt" } }))}\n`,
		);
		await browserExpect(page.locator('[data-entry-id="u3"]')).toBeVisible({ timeout: 10_000 });
		await browserExpect(page.locator("details[open]")).toHaveCount(1);
		expect(await page.evaluate(() => Reflect.get(window, "TRAJECTORY_XSS"))).toBeUndefined();
		await page.locator("#live").click();
		await browserExpect(page.locator("#status")).toHaveText("Paused");
		await page.locator("#collapse").click();
		await browserExpect(page.locator("details[open]")).toHaveCount(0);
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		await page.locator("#stop").click();
		await browserExpect(page.locator("#status")).toHaveText("Server stopped");
		expect(errors).toEqual([]);
	} finally {
		await browser?.close();
		await viewer.stop();
		await rm(root, { recursive: true, force: true });
	}
}

await smoke();
console.log(
	"Trajectory browser smoke: branches, filters, child navigation, refresh and stop passed.",
);
