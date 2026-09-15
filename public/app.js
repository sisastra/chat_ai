const $ = (selector) => document.querySelector(selector);
const state = { mode: "rag" };

async function api(url, options) {
	const response = await fetch(url, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
	const data = response.status === 204 ? null : await response.json();
	if (!response.ok) throw new Error(data?.error || "Permintaan gagal.");
	return data;
}
function escapeHtml(value) {
	return String(value).replace(
		/[&<>'"]/g,
		(char) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				"'": "&#039;",
				'"': "&quot;",
			})[char],
	);
}
function renderTable(rows) {
	if (!rows?.length)
		return '<p class="muted">Query tidak menghasilkan baris.</p>';
	const columns = Object.keys(rows[0]);
	return `<table class="data-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
async function refreshStatus() {
	const status = await api("/api/status");
	$("#connectionText").textContent = status.configured
		? "Gemini terhubung"
		: "Mode lokal aktif";
	$(".connection i").classList.toggle("online", status.configured);
	$(".status-dot").classList.toggle("online", status.configured);
	$("#modelName").textContent = status.configured
		? status.model
		: "Gemini offline mode";
	$("#creditMini").textContent =
		`${Number(status.usage.input) + Number(status.usage.output)} tok`;
}
function setMode(mode) {
	state.mode = mode;
	document
		.querySelectorAll(".mode-tab")
		.forEach((tab) =>
			tab.classList.toggle("active", tab.dataset.mode === mode),
		);
	$("#queryLabel").textContent =
		mode === "rag" ? "TANYAKAN PADA DOKUMEN" : "TANYAKAN PADA DATABASE";
	$("#hint").textContent =
		mode === "rag"
			? "Jawaban akan menyertakan konteks dokumen yang relevan."
			: "Query read-only akan dibuat dan dijalankan pada SQLite.";
	$("#question").placeholder =
		mode === "rag"
			? "Contoh: Apa kebijakan refund untuk paket tahunan?"
			: "Contoh: Berapa total penjualan berdasarkan wilayah?";
}
function showResult(data) {
	const area = $("#resultArea");
	area.classList.remove("hidden");
	const sqlPart = data.sql
		? `<h3>GENERATED SQL</h3><div class="sql-code">${escapeHtml(data.sql)}</div>${renderTable(data.rows)}`
		: `<p>${escapeHtml(data.answer)}</p>`;
	area.innerHTML = `<h3>${data.sql ? "DATABASE RESULT" : "RAG RESPONSE"}</h3>${sqlPart}<div class="result-meta"><span class="tag">${data.configured ? "GEMINI" : "LOCAL MODE"}</span>${data.sources?.map((source) => `<span class="tag">${escapeHtml(source)}</span>`).join("") || ""}</div>`;
}
$("#runQuery").addEventListener("click", async () => {
	const button = $("#runQuery");
	const question = $("#question").value.trim();
	if (!question) return;
	button.disabled = true;
	button.firstChild.textContent = "Memproses ";
	try {
		showResult(
			await api(state.mode === "rag" ? "/api/chat" : "/api/sql", {
				method: "POST",
				body: JSON.stringify({ question }),
			}),
		);
		await refreshStatus();
	} catch (error) {
		$("#resultArea").classList.remove("hidden");
		$("#resultArea").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
	} finally {
		button.disabled = false;
		button.firstChild.textContent = "Jalankan ";
	}
});
document
	.querySelectorAll(".mode-tab")
	.forEach((tab) =>
		tab.addEventListener("click", () => setMode(tab.dataset.mode)),
	);
document.querySelectorAll(".nav-item").forEach((item) =>
	item.addEventListener("click", () => {
		document
			.querySelectorAll(".nav-item")
			.forEach((nav) => nav.classList.toggle("active", nav === item));
		document
			.querySelectorAll(".view")
			.forEach((view) =>
				view.classList.toggle(
					"active-view",
					view.id === `${item.dataset.view}View`,
				),
			);
		$("#pageTitle").textContent = item.textContent.trim();
		if (item.dataset.view === "documents") loadDocuments();
		if (item.dataset.view === "history") loadHistory();
	}),
);
$("#documentForm").addEventListener("submit", async (event) => {
	event.preventDefault();
	await api("/api/documents", {
		method: "POST",
		body: JSON.stringify({
			title: $("#docTitle").value,
			content: $("#docContent").value,
		}),
	});
	event.target.reset();
	await loadDocuments();
});
async function loadDocuments() {
	const docs = await api("/api/documents");
	$("#documentList").innerHTML = docs.length
		? docs
				.map(
					(doc) =>
						`<article class="document-card"><button class="delete-doc" data-id="${doc.id}" title="Hapus dokumen">×</button><h3>${escapeHtml(doc.title)}</h3><p>${escapeHtml(doc.content)}</p></article>`,
				)
				.join("")
		: '<div class="document-card"><p>Belum ada dokumen. Tambahkan sumber pertama Anda.</p></div>';
	document.querySelectorAll(".delete-doc").forEach((button) =>
		button.addEventListener("click", async () => {
			await api(`/api/documents/${button.dataset.id}`, { method: "DELETE" });
			loadDocuments();
		}),
	);
}
async function loadHistory() {
	const history = await api("/api/history");
	$("#historyList").innerHTML = history.length
		? history
				.map(
					(item) =>
						`<article class="history-card"><div class="history-head"><span>${item.mode === "rag" ? "⌁ RAG" : "⌘ SQL"}</span><span>${new Date(item.createdAt + "Z").toLocaleString("id-ID")}</span></div><b>${escapeHtml(item.question)}</b><p>${escapeHtml(item.answer)}</p></article>`,
				)
				.join("")
		: '<div class="history-card"><p>Belum ada aktivitas.</p></div>';
}
refreshStatus();
