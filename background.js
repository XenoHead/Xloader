import {
	formatDate,
	formatTime,
	getRecord,
	hostOf,
	originOf,
	putRecord,
	resolveSource,
	siteOf
} from "./lib/xstore.js";

const MENU_ID = "check-xloads";
const LIST_PAGE = "xloads.html";
const MAX_CHAIN = 12;
const CHAINS_KEY = "xload:chains";

/* ------------------------------------------------------------------ *
 * Site chain per tab
 *
 * A download rarely happens on the site the user started from: links hop through
 * a file host, a CDN or a redirector first. Every site the tab passes through is
 * remembered, so the list can say where a download came from instead of only
 * naming the host that served the file.
 *
 * The chains live in storage.session as well as memory: the service worker is
 * evicted when it goes idle, and a chain that vanishes would lose the origin site.
 *
 * The tab events are used rather than webNavigation because Chrome hides the URL
 * from webNavigation events unless the extension has host permissions for the
 * site. The tabs permission is enough to see where a tab went.
 * ------------------------------------------------------------------ */

const siteChains = new Map();
let lastTouchedTab = -1;
let chainsReady = null;
let flushTimer = null;

function sessionStore() {
	return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

function ensureChains() {
	if (!chainsReady) {
		const store = sessionStore();
		chainsReady = store
			? store
					.get(CHAINS_KEY)
					.then((result) => {
						const stored = result[CHAINS_KEY] || {};
						for (const [tabId, sites] of Object.entries(stored)) {
							if (Array.isArray(sites)) siteChains.set(Number(tabId), sites);
						}
					})
					.catch(() => undefined)
			: Promise.resolve();
	}
	return chainsReady;
}

function scheduleFlush() {
	if (flushTimer || !sessionStore()) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushChains();
	}, 400);
}

async function flushChains() {
	const store = sessionStore();
	if (!store) return;
	try {
		await store.set({ [CHAINS_KEY]: Object.fromEntries(siteChains) });
	} catch {
		/* keep the in-memory chain only */
	}
}

function rememberSite(tabId, url) {
	if (typeof tabId !== "number" || tabId < 0) return;
	const site = siteOf(url);
	if (!site) return;
	ensureChains().then(() => {
		const chain = siteChains.get(tabId) || [];
		if (chain[chain.length - 1] !== site) chain.push(site);
		while (chain.length > MAX_CHAIN) chain.shift();
		siteChains.set(tabId, chain);
		lastTouchedTab = tabId;
		scheduleFlush();
	});
}

async function chainFor(tabId) {
	await ensureChains();
	if (typeof tabId !== "number" || tabId < 0) return [];
	return (siteChains.get(tabId) || []).slice();
}

/**
 * A download can start without a tab (the tab closed, the page was backgrounded,
 * a service worker kicked it off). The referrer still says which page asked for
 * it, so the chain of the tab showing that page is the one to use.
 */
async function chainForReferrer(referrerOrigin) {
	await ensureChains();
	if (referrerOrigin) {
		for (const chain of siteChains.values()) {
			if (chain[chain.length - 1] === referrerOrigin) return chain.slice();
		}
		for (const chain of siteChains.values()) {
			if (chain.includes(referrerOrigin)) return chain.slice();
		}
		// no tab was showing that page: the referrer itself is the origin site
		return [];
	}
	if (lastTouchedTab >= 0) {
		const chain = siteChains.get(lastTouchedTab);
		if (chain && chain.length) return chain.slice();
	}
	return [];
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.url) rememberSite(tabId, changeInfo.url);
});

chrome.tabs.onCreated.addListener((tab) => {
	if (typeof tab.openerTabId !== "number" || typeof tab.id !== "number") return;
	ensureChains().then(() => {
		const parent = siteChains.get(tab.openerTabId);
		if (!parent || !parent.length) return;
		// a link opened in a new tab keeps the history of the tab it came from
		siteChains.set(tab.id, parent.slice());
		lastTouchedTab = tab.id;
		scheduleFlush();
	});
});

chrome.tabs.onRemoved.addListener((tabId) => {
	ensureChains().then(() => {
		if (siteChains.delete(tabId)) scheduleFlush();
	});
});

/* ------------------------------------------------------------------ *
 * Context menu + list tab
 * ------------------------------------------------------------------ */

function createMenu() {
	chrome.contextMenus.create(
		{
			id: MENU_ID,
			title: "Check Xloads",
			contexts: ["action"]
		},
		() => void chrome.runtime.lastError
	);
}

function ensureMenu() {
	chrome.contextMenus.removeAll(() => createMenu());
}

chrome.runtime.onInstalled.addListener(ensureMenu);
chrome.runtime.onStartup.addListener(ensureMenu);

async function openList() {
	const url = chrome.runtime.getURL(LIST_PAGE);
	try {
		const tabs = await chrome.tabs.query({ url });
		const existing = tabs && tabs.length ? tabs[0] : null;
		if (existing) {
			await chrome.tabs.update(existing.id, { active: true });
			await chrome.windows.update(existing.windowId, { focused: true });
			return;
		}
	} catch {
		/* fall through and open a fresh tab */
	}
	await chrome.tabs.create({ url });
}

chrome.contextMenus.onClicked.addListener((info) => {
	if (info.menuItemId === MENU_ID) openList();
});

chrome.action.onClicked.addListener(() => openList());

/* ------------------------------------------------------------------ *
 * Download tracking
 * ------------------------------------------------------------------ */

function baseName(path) {
	if (!path) return "";
	const parts = String(path).split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/**
 * Chrome reports a changed download field as {current, previous} whenever the
 * field can hold a previous value (state, error, mime, filename, finalUrl...).
 * Taking the raw delta would put objects into the record.
 */
function unwrapChange(value) {
	if (value && typeof value === "object" && !Array.isArray(value) && "current" in value) {
		return value.current;
	}
	return value;
}

/** Chrome hands out dates as Date objects on some builds and numbers on others. */
function toTimestamp(value) {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? 0 : parsed;
	}
	return 0;
}

async function sourceTabUrl(tabId) {
	if (typeof tabId !== "number" || tabId < 0) return "";
	try {
		const tab = await chrome.tabs.get(tabId);
		return tab && tab.url ? tab.url : "";
	} catch {
		return "";
	}
}

function buildRecord(item, pageUrl, chain = []) {
	const startedAt = toTimestamp(item.startTime) || Date.now();
	const downloadUrl = item.url || "";
	const finalUrl = item.finalUrl || downloadUrl;
	const referrer = item.referrer || "";
	const pageOrigin = siteOf(pageUrl);
	const referrerOrigin = siteOf(referrer);
	const downloadOrigin = originOf(downloadUrl);
	const fileOrigin = originOf(finalUrl) || downloadOrigin;
	const fileHost = hostOf(finalUrl) || hostOf(downloadUrl);
	const sourceOrigin = resolveSource({
		chain,
		fileOrigin,
		downloadOrigin,
		referrerOrigin,
		pageOrigin
	});

	return {
		id: item.id,
		startedAt,
		date: formatDate(startedAt),
		time: formatTime(startedAt),
		filename:
			baseName(unwrapChange(item.filename)) || baseName(finalUrl) || baseName(downloadUrl) || "download",
		downloadUrl,
		finalUrl,
		// where the bytes actually came from
		fileOrigin,
		fileHost,
		downloadOrigin,
		// where the user came from
		sourceOrigin,
		sourceHost: hostOf(sourceOrigin) || fileHost,
		chain,
		// kept for reference and for older records
		site: fileOrigin,
		siteHost: fileHost,
		referrer,
		pageUrl,
		referrerHost: hostOf(referrer) || hostOf(pageUrl),
		mime: String(unwrapChange(item.mime) || ""),
		state: String(unwrapChange(item.state) || "in_progress"),
		bytesReceived: item.bytesReceived || 0,
		totalBytes: item.totalBytes || 0,
		error: String(unwrapChange(item.error) || ""),
		dangerous: !!item.danger,
		endedAt: toTimestamp(item.endTime)
	};
}

chrome.downloads.onCreated.addListener((item) => {
	if (!item || typeof item.id !== "number") return;
	ensureChains()
		.then(() =>
			item.tabId >= 0
				? chainFor(item.tabId)
				: chainForReferrer(siteOf(item.referrer))
		)
		.then((chain) => sourceTabUrl(item.tabId).then((pageUrl) => putRecord(buildRecord(item, pageUrl, chain))))
		.catch((error) => {
			console.error("Xloader: could not record download", error);
		});
});

chrome.downloads.onChanged.addListener((delta) => {
	if (!delta || typeof delta.id !== "number") return;
	handleChanged(delta).catch((error) => {
		console.error("Xloader: could not update download", error);
	});
});

async function handleChanged(delta) {
	const existing = await getRecord(delta.id);
	if (!existing) {
		const found = await chrome.downloads.search({ id: delta.id });
		if (found && found.length) {
			await putRecord(buildRecord(found[0], ""));
		}
		return;
	}

	const change = {};
	for (const [key, value] of Object.entries(delta)) {
		change[key] = unwrapChange(value);
	}

	const next = { ...existing };
	if (change.state) next.state = String(change.state);
	if (change.error) next.error = String(change.error);
	if (typeof change.bytesReceived === "number") next.bytesReceived = change.bytesReceived;
	if (typeof change.totalBytes === "number") next.totalBytes = change.totalBytes;
	if (change.filename) next.filename = baseName(change.filename);
	if (change.mime) next.mime = String(change.mime);
	if (change.endTime) next.endedAt = toTimestamp(change.endTime);
	if (change.danger !== undefined) next.dangerous = !!change.danger;
	if (change.referrer) next.referrer = change.referrer;

	if (change.finalUrl) {
		next.finalUrl = change.finalUrl;
		next.fileOrigin = originOf(change.finalUrl) || next.fileOrigin;
		next.fileHost = hostOf(change.finalUrl) || next.fileHost;
		next.site = next.fileOrigin;
		next.siteHost = next.fileHost;
		next.sourceOrigin = resolveSource({
			chain: next.chain || [],
			fileOrigin: next.fileOrigin,
			downloadOrigin: originOf(next.downloadUrl),
			referrerOrigin: siteOf(next.referrer),
			pageOrigin: siteOf(next.pageUrl)
		});
		next.sourceHost = hostOf(next.sourceOrigin) || next.fileHost;
	}

	if (!next.referrerHost) {
		next.referrerHost = hostOf(next.referrer) || hostOf(next.pageUrl);
	}

	await putRecord(next);
}
