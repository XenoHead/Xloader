export const INDEX_KEY = "xload:index";
export const RECORD_PREFIX = "xload:";
export const MAX_RECORDS = 2000;

export function recordKey(id) {
	return `${RECORD_PREFIX}${id}`;
}

export function parseUrl(url) {
	if (!url) return null;
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

export function hostOf(url) {
	const parsed = parseUrl(url);
	if (!parsed) return "";
	return parsed.hostname.replace(/^www\./i, "");
}

export function originOf(url) {
	const parsed = parseUrl(url);
	if (!parsed) return "";
	if (parsed.protocol === "file:") return "file://";
	return parsed.origin;
}

/**
 * The browsable address of a page: origin for web pages, full path for local files.
 * Used for link targets and for comparing "same site" entries.
 */
export function siteOf(url) {
	const parsed = parseUrl(url);
	if (!parsed) return "";
	if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
	if (parsed.protocol === "file:") return parsed.href;
	return parsed.origin || "";
}

export function isWebUrl(url) {
	const parsed = parseUrl(url);
	return !!parsed && (parsed.protocol === "http:" || parsed.protocol === "https:");
}

/**
 * Works out which site a download really came from.
 *
 * A download usually does not happen on the site the user started from: the link
 * hops through a file host, a CDN or a redirector first. `chain` lists the sites
 * the tab passed through, oldest first, and `fileOrigin` / `downloadOrigin` are the
 * hosts that served the bytes. The source is the last site in the chain that is
 * not one of those file hosts, so lewdcorner.com stays the answer even when the
 * file itself is served by pixeldrain.com.
 */
export function resolveSource({
	chain = [],
	fileOrigin = "",
	downloadOrigin = "",
	referrerOrigin = "",
	pageOrigin = ""
} = {}) {
	const entries = chain.filter(Boolean);
	const served = new Set([fileOrigin, downloadOrigin].filter(Boolean));

	let end = entries.length;
	while (end > 0 && served.has(entries[end - 1])) end -= 1;
	if (end > 0) return entries[end - 1];

	if (referrerOrigin && !served.has(referrerOrigin)) return referrerOrigin;
	if (pageOrigin && !served.has(pageOrigin)) return pageOrigin;
	return (
		referrerOrigin ||
		pageOrigin ||
		entries[entries.length - 1] ||
		fileOrigin ||
		downloadOrigin ||
		""
	);
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23"
});

export function formatDate(timestamp) {
	if (!timestamp) return "";
	try {
		return dateFormatter.format(new Date(timestamp));
	} catch {
		return "";
	}
}

export function formatTime(timestamp) {
	if (!timestamp) return "";
	try {
		return timeFormatter.format(new Date(timestamp));
	} catch {
		return "";
	}
}

let writeLock = Promise.resolve();

function withLock(task) {
	const result = writeLock.then(task, task);
	writeLock = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

export async function getRecord(id) {
	const key = recordKey(id);
	const result = await chrome.storage.local.get(key);
	return result[key] || null;
}

export async function listRecords() {
	const result = await chrome.storage.local.get(INDEX_KEY);
	const index = Array.isArray(result[INDEX_KEY]) ? result[INDEX_KEY] : [];
	if (!index.length) return [];

	const payload = await chrome.storage.local.get(index.map(recordKey));
	const records = [];
	for (const id of index) {
		const record = payload[recordKey(id)];
		if (record) records.push(normalizeRecord(record));
	}
	return records;
}

/**
 * Chrome reports changed download fields as {current, previous}. Records written
 * before that was handled can still hold those objects, so they are flattened on
 * the way out and a filename that was lost is recovered from the URL.
 */
function normalizeRecord(record) {
	const flatten = (value) => {
		if (value && typeof value === "object" && !Array.isArray(value) && "current" in value) {
			return value.current;
		}
		return value;
	};

	const normalized = { ...record };
	for (const key of ["filename", "mime", "state", "finalUrl", "error", "referrer", "downloadUrl"]) {
		const value = flatten(record[key]);
		if (value !== undefined) normalized[key] = value;
	}

	if (!normalized.filename || normalized.filename === "[object Object]") {
		normalized.filename = filenameFromUrl(normalized.finalUrl || normalized.downloadUrl);
	}
	return normalized;
}

function filenameFromUrl(url) {
	if (!url) return "download";
	try {
		const parsed = new URL(url);
		const name = parsed.pathname.split("/").filter(Boolean).pop();
		return name || parsed.hostname || "download";
	} catch {
		return "download";
	}
}

export async function putRecord(record) {
	await withLock(async () => {
		const result = await chrome.storage.local.get(INDEX_KEY);
		const index = Array.isArray(result[INDEX_KEY]) ? result[INDEX_KEY].slice() : [];

		const existing = index.indexOf(record.id);
		if (existing !== -1) index.splice(existing, 1);
		index.unshift(record.id);

		const overflow = index.splice(MAX_RECORDS);
		const payload = { [INDEX_KEY]: index, [recordKey(record.id)]: record };
		await chrome.storage.local.set(payload);
		if (overflow.length) {
			await chrome.storage.local.remove(overflow.map(recordKey));
		}
	});
}

export async function removeRecord(id) {
	await withLock(async () => {
		const result = await chrome.storage.local.get(INDEX_KEY);
		const index = Array.isArray(result[INDEX_KEY]) ? result[INDEX_KEY] : [];
		await chrome.storage.local.set({
			[INDEX_KEY]: index.filter((entry) => entry !== id)
		});
		await chrome.storage.local.remove(recordKey(id));
	});
}

export async function clearRecords() {
	await withLock(async () => {
		const result = await chrome.storage.local.get(null);
		const keys = Object.keys(result).filter(
			(key) => key === INDEX_KEY || key.startsWith(RECORD_PREFIX)
		);
		if (keys.length) await chrome.storage.local.remove(keys);
	});
}
