import { mkdirSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { apiClient, ProjectId } from "@pecore/schemas";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	Notification,
	nativeImage,
	net,
	protocol,
	session,
	Tray,
} from "electron";
import type { EngineHandle } from "./engine";
import { startEngine } from "./engine";

const userData: string = app.commandLine.hasSwitch("user-data-dir") ? app.getPath("userData") : join(app.getPath("appData"), "PeCore");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
app.setPath("sessionData", userData);
protocol.registerSchemesAsPrivileged([
	{
		scheme: "app",
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

const devUrl = process.env.ELECTRON_RENDERER_URL ?? null;
const rendererDir = join(import.meta.dirname, "../renderer");
let engine: EngineHandle | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hiddenOnce = false;
let quitting = false;

function csp(port: number): string {
	return [
		"default-src 'self'",
		`connect-src http://127.0.0.1:${port} ws://127.0.0.1:${port}${devUrl ? ` ${new URL(devUrl).origin.replace("http", "ws")}` : ""}`,
		`script-src 'self'${devUrl ? " 'unsafe-inline'" : ""}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"object-src 'none'",
		"base-uri 'none'",
		"frame-src 'none'",
	].join("; ");
}

async function homeLocation(): Promise<string> {
	const file = join(app.getPath("userData"), "home.json");
	const stored = await readFile(file, "utf8").then(
		(t) => (JSON.parse(t) as { home: string }).home,
		() => null,
	);
	return stored || join(homedir(), ".pecore");
}

async function resourcesDir(): Promise<string> {
	if (app.isPackaged) return process.resourcesPath;
	const dir = join(app.getPath("userData"), "dev-resources");
	const repo = resolve(app.getAppPath(), "../..");
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await symlink(
		join(repo, "packages/app/resources/templates"),
		join(dir, "templates"),
	);
	await symlink(
		join(repo, "packages/app/resources/connectors"),
		join(dir, "connectors"),
	);
	await symlink(
		join(repo, "packages/agents/out/adapters"),
		join(dir, "adapters"),
	);
	await symlink(
		join(repo, "packages/agents/adapters.json"),
		join(dir, "adapters.json"),
	);
	return dir;
}

function iconPath(): string {
	return app.isPackaged
		? join(process.resourcesPath, "icon.png")
		: resolve(app.getAppPath(), "resources/icon.png");
}

function serveRenderer(port: number): void {
	protocol.handle("app", async (req) => {
		const url = new URL(req.url);
		const rel = normalize(decodeURIComponent(url.pathname)).replace(
			/^([/\\])+/,
			"",
		);
		const file = join(rendererDir, rel);
		const inside = file.startsWith(rendererDir + "/") && extname(file) !== "";
		const res = await net.fetch(
			pathToFileURL(inside ? file : join(rendererDir, "index.html")).toString(),
		);
		const headers = new Headers(res.headers);
		headers.set("content-security-policy", csp(port));
		return new Response(res.body, { status: res.status, headers });
	});
	if (devUrl)
		session.defaultSession.webRequest.onHeadersReceived(
			{ urls: [`${new URL(devUrl).origin}/*`] },
			(details, cb) => {
				cb({
					responseHeaders: {
						...details.responseHeaders,
						"content-security-policy": [csp(port)],
					},
				});
			},
		);
}

function showWindow(): void {
	if (!win) return createWindow();
	win.show();
	win.focus();
}

function createWindow(): void {
	const [width, height] = (!app.isPackaged &&
		process.env.PECORE_SCREENSHOT_SIZE?.split("x").map(Number)) || [1400, 900];
	win = new BrowserWindow({
		width,
		height,
		minWidth: 960,
		minHeight: 600,
		title: "<PE/CORE>",
		icon: iconPath(),
		backgroundColor: "#1e2326",
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	win.setMenuBarVisibility(false);
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://"))
			void import("electron").then(({ shell }) => shell.openExternal(url));
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (e, url) => {
		if (!url.startsWith("app://pecore") && !(devUrl && url.startsWith(devUrl)))
			e.preventDefault();
	});
	win.on("close", (e) => {
		if (quitting) return;
		e.preventDefault();
		win?.hide();
		if (!hiddenOnce) {
			hiddenOnce = true;
			new Notification({
				title: "<PE/CORE> keeps running",
				body: "Jobs continue in the background. Quit from the tray icon or the app menu.",
			}).show();
		}
	});
	const shot = app.isPackaged ? undefined : process.env.PECORE_SCREENSHOT;
	if (shot) {
		win.webContents.on("console-message", (e) =>
			console.error(`renderer ${e.level}: ${e.message}`),
		);
		win.webContents.once("did-finish-load", () => {
			setTimeout(
				async () => {
					await writeFile(shot, (await win!.webContents.capturePage()).toPNG());
					await quit();
				},
				Number(process.env.PECORE_SCREENSHOT_DELAY ?? 4000),
			);
		});
	}
	const route: string = (shot && process.env.PECORE_SCREENSHOT_ROUTE) || "#/";
	void win.loadURL(`${devUrl ?? "app://pecore/"}${route}`);
}

async function updateTray(): Promise<void> {
	if (!engine || !tray) return;
	const call = apiClient({ port: engine.port, token: engine.token });
	const [status, jobs] = await Promise.all([
		call("getStatus"),
		call("listJobs", { query: { archived: "false" } }),
	]).catch(() => [null, null] as const);
	if (!status || !jobs) return;
	const running = jobs.filter((j) => j.state === "running").length;
	tray.setToolTip(
		`<PE/CORE>: ${running} running, ${status.notifications} notifications`,
	);
}

async function quit(): Promise<void> {
	if (quitting) return;
	if (engine) {
		const active = await engine.active();
		if (active > 0) {
			const r = await dialog.showMessageBox({
				type: "warning",
				message: `${active} job${active === 1 ? "" : "s"} will be interrupted`,
				detail:
					"They will be paused and can be played again at the next start.",
				buttons: ["Quit", "Cancel"],
				defaultId: 1,
				cancelId: 1,
			});
			if (r.response === 1) return;
		}
	}
	quitting = true;
	await engine?.shutdown(15_000);
	app.exit(0);
}

async function main(): Promise<void> {
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	app.on("second-instance", () => showWindow());
	await app.whenReady();
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "<PE/CORE>",
				submenu: [
					{ label: "Open <PE/CORE>", click: () => showWindow() },
					{
						label: "Quit",
						accelerator: "CmdOrCtrl+Q",
						click: () => void quit(),
					},
				],
			},
		]),
	);
	const home = await homeLocation();
	try {
		engine = await startEngine(
			{
				home,
				resources: await resourcesDir(),
				version: app.getVersion(),
				devOrigin: devUrl ? new URL(devUrl).origin : null,
				downloads: app.getPath("downloads"),
			},
			{
				notify: (n) => {
					if (win && !win.isDestroyed() && win.isFocused()) return;
					new Notification({ title: n.title, body: n.body }).show();
				},
				exited: (code) => {
					if (quitting) return;
					console.error(`<PE/CORE> engine exited with code ${code}`);
					dialog.showErrorBox(
						"<PE/CORE> engine stopped",
						`The engine exited with code ${code}. <PE/CORE> will quit.`,
					);
					app.exit(1);
				},
			},
		);
	} catch (e) {
		console.error("<PE/CORE> could not start:", e);
		dialog.showErrorBox("<PE/CORE> could not start", (e as Error).message);
		app.exit(1);
		return;
	}
	const api = { port: engine.port, token: engine.token };
	ipcMain.handle("pecore:api", () => api);
	ipcMain.handle("pecore:pick-folder", async (event) => {
		const options: Electron.OpenDialogOptions = {
			properties: ["openDirectory", "createDirectory"],
		};
		const owner: BrowserWindow | null = BrowserWindow.fromWebContents(
			event.sender,
		);
		const picked: Electron.OpenDialogReturnValue = owner
			? await dialog.showOpenDialog(owner, options)
			: await dialog.showOpenDialog(options);
		return picked.canceled ? null : (picked.filePaths[0] ?? null);
	});
	ipcMain.handle("pecore:pick-file", async (event, defaultPath: unknown) => {
		const options: Electron.OpenDialogOptions = {
			properties: ["openFile"],
			filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
			...(typeof defaultPath === "string" ? { defaultPath } : {}),
		};
		const owner: BrowserWindow | null = BrowserWindow.fromWebContents(
			event.sender,
		);
		const picked: Electron.OpenDialogReturnValue = owner
			? await dialog.showOpenDialog(owner, options)
			: await dialog.showOpenDialog(options);
		return picked.canceled ? null : (picked.filePaths[0] ?? null);
	});
	ipcMain.handle(
		"pecore:pick-project-export",
		async (event, source: unknown) => {
			if (source !== "archive" && source !== "folder")
				throw new Error("Invalid project import source");
			const options: Electron.OpenDialogOptions =
				source === "folder"
					? {
							title: "Choose an extracted project",
							properties: ["openDirectory"],
						}
					: {
							title: "Choose a <PE/CORE> export",
							properties: ["openFile"],
							filters: [{ name: "<PE/CORE> export", extensions: ["zst"] }],
						};
			const owner: BrowserWindow | null = BrowserWindow.fromWebContents(
				event.sender,
			);
			const picked: Electron.OpenDialogReturnValue = owner
				? await dialog.showOpenDialog(owner, options)
				: await dialog.showOpenDialog(options);
			return picked.canceled ? null : (picked.filePaths[0] ?? null);
		},
	);
	ipcMain.handle("pecore:save-project-export", async (event, id: unknown) => {
		const project: string = ProjectId.parse(id);
		const downloads: string = app.getPath("downloads");
		await mkdir(downloads, { recursive: true });
		const options: Electron.SaveDialogOptions = {
			title: "Export project",
			defaultPath: join(downloads, `${project}.tar.zst`),
			filters: [{ name: "<PE/CORE> export", extensions: ["zst"] }],
		};
		const owner: BrowserWindow | null = BrowserWindow.fromWebContents(
			event.sender,
		);
		const picked: Electron.SaveDialogReturnValue = owner
			? await dialog.showSaveDialog(owner, options)
			: await dialog.showSaveDialog(options);
		if (picked.canceled || !picked.filePath) return null;
		return picked.filePath.endsWith(".tar.zst")
			? picked.filePath
			: `${picked.filePath.replace(/\.zst$/, "")}.tar.zst`;
	});
	serveRenderer(engine.port);
	tray = new Tray(
		nativeImage.createFromPath(iconPath()).resize({ width: 22, height: 22 }),
	);
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open <PE/CORE>", click: () => showWindow() },
			{ label: "Quit", click: () => void quit() },
		]),
	);
	tray.on("click", () => showWindow());
	setInterval(() => void updateTray(), 5000);
	void updateTray();
	createWindow();
	app.on("before-quit", (e) => {
		if (quitting) return;
		e.preventDefault();
		void quit();
	});
	app.on("window-all-closed", () => undefined);
}

void main();
