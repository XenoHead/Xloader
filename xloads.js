import {
	clearRecords,
	formatDate,
	formatTime,
	hostOf,
	isWebUrl,
	listRecords
} from "./lib/xstore.js";

const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");
const emptyTitleEl = document.getElementById("empty-title");
const emptyHintEl = document.getElementById("empty-hint");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const statusEl = document.getElementById("status-line");

const state = {
	records: [],
	query: "",
	filter: "all"
};

const ICONS = {
	copy: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 4.5H6.5A2.5 2.5 0 0 0 4 7v6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	folder:
		'<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3l1.4 1.8h6.6A1.5 1.5 0 0 1 17 8.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
};

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Chrome can hand a field over as {current, previous} or as a Date. Anything that
 * is not plain text is flattened here so a row never renders "[object Object]".
 */
function text(value) {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "object") {
		if (typeof value.current === "string") return value.current;
		try {
			return JSON.stringify(value);
		} catch {
			return "";
		}
	}
	return "";
}

function formatBytes(bytes) {
	if (!bytes || bytes < 0) return "";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const rounded = unit === 0 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1);
	return `${rounded} ${units[unit]}`;
}

function statusInfo(record) {
	const status = text(record.state);
	if (status === "complete") return { label: "Complete", cls: "ok" };
	if (status === "in_progress") return { label: "Downloading", cls: "active" };
	if (status === "interrupted") {
		return { label: record.error ? "Failed" : "Paused", cls: record.error ? "err" : "warn" };
	}
	return { label: status || "Unknown", cls: "warn" };
}

function matches(record) {
	if (state.filter !== "all" && record.state !== state.filter) return false;
	if (!state.query) return true;
	const haystack = [
		record.filename,
		record.downloadUrl,
		record.finalUrl,
		record.sourceOrigin,
		record.sourceHost,
		record.fileOrigin,
		record.fileHost,
		record.siteHost,
		record.site,
		record.referrer,
		record.pageUrl,
		record.referrerHost,
		record.mime,
		...(Array.isArray(record.chain) ? record.chain : [])
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(state.query);
}

function buildRow(record) {
	const when = document.createElement("div");
	when.className = "cell when";
	const date = record.date || formatDate(record.startedAt);
	const clock = record.time || formatTime(record.startedAt);
	when.innerHTML = `<span class="date">${escapeHtml(date)}</span><span class="clock">${escapeHtml(clock)}</span>`;

	const file = document.createElement("div");
	file.className = "cell file";
	const link = text(record.finalUrl) || text(record.downloadUrl);
	const meta = [formatBytes(record.totalBytes || record.bytesReceived), text(record.mime)]
		.filter(Boolean)
		.join(" · ");
	const status = statusInfo(record);
	file.innerHTML = `
		<a class="name" href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(link)}">${escapeHtml(text(record.filename))}</a>
		${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
		<a class="url" href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(link)}">${escapeHtml(link)}</a>
		${status.cls === "err" && record.error ? `<div class="meta">${escapeHtml(text(record.error))}</div>` : ""}
	`;

	const source = document.createElement("div");
	source.className = "cell source";

	const sourceOrigin = record.sourceOrigin || record.site || "";
	const sourceLabel = record.sourceHost || hostOf(sourceOrigin) || "unknown";
	const fileOrigin = record.fileOrigin || record.site || "";
	const fileLabel = record.fileHost || hostOf(fileOrigin) || "";

	const chain = Array.isArray(record.chain) ? record.chain : [];
	const chainTip = chain.length
		? chain.map((entry) => hostOf(entry) || entry).join("  →  ")
		: sourceOrigin || record.referrer || record.pageUrl || "";

	const primary = sourceOrigin && isWebUrl(sourceOrigin)
		? `<a class="site" href="${escapeHtml(sourceOrigin)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(chainTip)}">${escapeHtml(sourceLabel)}</a>`
		: `<span class="site" title="${escapeHtml(chainTip)}">${escapeHtml(sourceLabel)}</span>`;

	const secondary =
		fileLabel && fileLabel !== sourceLabel
			? `<div class="from">file · ${
					fileOrigin && isWebUrl(fileOrigin)
						? `<a href="${escapeHtml(fileOrigin)}" target="_blank" rel="noreferrer noopener" title="${escapeHtml(fileOrigin)}">${escapeHtml(fileLabel)}</a>`
						: escapeHtml(fileLabel)
				}</div>`
			: "";

	source.innerHTML = `${primary}${secondary}`;

	const statusCell = document.createElement("div");
	statusCell.className = "cell";
	statusCell.innerHTML = `<span class="pill ${status.cls}">${escapeHtml(status.label)}</span>`;

	const actions = document.createElement("div");
	actions.className = "cell row-actions";
	const revealDisabled = record.state === "complete" ? "" : "disabled";
	actions.innerHTML = `
		<button type="button" class="icon-btn" data-act="copy" title="Copy download link">${ICONS.copy}</button>
		<button type="button" class="icon-btn" data-act="reveal" title="Show in folder" ${revealDisabled}>${ICONS.folder}</button>
	`;

	const row = document.createElement("article");
	row.className = "row";
	row.dataset.id = String(record.id);
	row.append(when, file, source, statusCell, actions);
	return row;
}

function render() {
	const visible = state.records.filter(matches);
	countEl.textContent = String(state.records.length);

	const fragment = document.createDocumentFragment();
	for (const record of visible) fragment.append(buildRow(record));
	rowsEl.replaceChildren(fragment);

	const hasRecords = state.records.length > 0;
	emptyEl.hidden = visible.length > 0;
	if (!visible.length) {
		if (hasRecords) {
			emptyTitleEl.textContent = "Nothing matches that filter";
			emptyHintEl.textContent = "Try a different search term or switch back to All.";
		} else {
			emptyTitleEl.textContent = "No downloads recorded yet";
			emptyHintEl.textContent =
				"Start a download in Chrome and it lands here the moment it begins.";
		}
	}
}

async function load() {
	try {
		state.records = await listRecords();
	} catch (error) {
		state.records = [];
		render();
		throw error;
	}
	render();
}

function setStatus(message, isError = false) {
	statusEl.textContent = message;
	statusEl.classList.toggle("is-error", isError);
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.append(area);
		area.select();
		const ok = document.execCommand("copy");
		area.remove();
		return ok;
	}
}

function downloadBlob(filename, content, type) {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
	return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toCsv(records) {
	const header = [
		"Date",
		"Time",
		"Filename",
		"Status",
		"Size (bytes)",
		"Downloaded from",
		"File host",
		"Chain",
		"Download URL",
		"Final URL",
		"MIME",
		"Error"
	];
	const lines = [header.map(csvCell).join(",")];
	for (const record of records) {
		lines.push(
			[
				record.date || formatDate(record.startedAt),
				record.time || formatTime(record.startedAt),
				record.filename,
				record.state,
				record.totalBytes || record.bytesReceived || 0,
				record.sourceHost || record.siteHost || "",
				record.fileHost || record.siteHost || "",
				(Array.isArray(record.chain) ? record.chain : []).join(" -> "),
				record.downloadUrl,
				record.finalUrl,
				record.mime,
				record.error
			]
				.map(csvCell)
				.join(",")
		);
	}
	return lines.join("\r\n");
}

function stamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/* ---------- events ---------- */

searchEl.addEventListener("input", () => {
	state.query = searchEl.value.trim().toLowerCase();
	render();
});

for (const button of document.querySelectorAll(".segment")) {
	button.addEventListener("click", () => {
		for (const other of document.querySelectorAll(".segment")) other.classList.remove("is-active");
		button.classList.add("is-active");
		state.filter = button.dataset.filter || "all";
		render();
	});
}

rowsEl.addEventListener("click", async (event) => {
	const button = event.target.closest("button[data-act]");
	if (!button) return;
	const row = button.closest(".row");
	if (!row) return;
	const record = state.records.find((entry) => String(entry.id) === row.dataset.id);
	if (!record) return;

	if (button.dataset.act === "copy") {
		const ok = await copyText(record.finalUrl || record.downloadUrl);
		setStatus(ok ? "Link copied to clipboard." : "Could not copy the link.", !ok);
		return;
	}

	if (button.dataset.act === "reveal") {
		try {
			await chrome.downloads.show(record.id);
		} catch {
			setStatus("That file is no longer available on disk.", true);
		}
	}
});

document.getElementById("refresh").addEventListener("click", async () => {
	await load();
	setStatus(`Refreshed — ${state.records.length} download(s) on record.`);
});

document.getElementById("copy-links").addEventListener("click", async () => {
	if (!state.records.length) {
		setStatus("Nothing to copy yet.", true);
		return;
	}
	const text = state.records.map((record) => record.finalUrl || record.downloadUrl).join("\n");
	const ok = await copyText(text);
	setStatus(ok ? `${state.records.length} link(s) copied.` : "Could not copy the links.", !ok);
});

document.getElementById("export-csv").addEventListener("click", () => {
	if (!state.records.length) {
		setStatus("Nothing to export yet.", true);
		return;
	}
	downloadBlob(`xloads-${stamp()}.csv`, toCsv(state.records), "text/csv;charset=utf-8");
	setStatus(`Exported ${state.records.length} record(s) to CSV.`);
});

document.getElementById("clear-all").addEventListener("click", async () => {
	if (!state.records.length) {
		setStatus("The history is already empty.", true);
		return;
	}
	if (!window.confirm(`Delete all ${state.records.length} recorded download(s)? This cannot be undone.`)) {
		return;
	}
	await clearRecords();
	await load();
	setStatus("History cleared.");
});

let refreshTimer = null;
if (chrome.storage && chrome.storage.onChanged) {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local") return;
		const relevant = Object.keys(changes).some(
			(key) => key === "xload:index" || key.startsWith("xload:")
		);
		if (!relevant) return;
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			load().then(() => setStatus("Updated."));
		}, 250);
	});
}

load()
	.then(() => setStatus(`${state.records.length} download(s) on record.`))
	.catch((error) => setStatus(`Could not read the history: ${error.message}`, true));
