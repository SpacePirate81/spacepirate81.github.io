const PASS_HEADERS = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"etag"
];
function mediaFileId(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (!parsed.pathname.startsWith("/chart-media/")) return null;
	const raw = parsed.pathname.slice(13);
	if (!raw || raw.includes("/")) return null;
	let id = "";
	try {
		id = decodeURIComponent(raw);
	} catch {
		return null;
	}
	if (!id || id.includes("/") || id === "." || id === "..") return null;
	return id;
}
function driveMediaUrl(fileId) {
	return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
}
function normalizeToken(token) {
	const trimmed = token?.trim() ?? "";
	return trimmed ? trimmed : null;
}
/**
* Forward one playback read to Drive.
* The bytes, status, and range are Drive's. Nothing is re-encoded, and nothing is cached.
*/
async function forwardWav(request, token, fetchImpl = fetch) {
	const fileId = mediaFileId(request.url);
	if (!fileId) return new Response(null, {
		status: 404,
		headers: { "Cache-Control": "no-store" }
	});
	if (request.method !== "GET" && request.method !== "HEAD") return new Response("Chart only forwards playback reads.", {
		status: 405,
		headers: { "Cache-Control": "no-store" }
	});
	const current = normalizeToken(token);
	if (!current) return new Response("Sign in before playing a Drive file.", {
		status: 401,
		headers: { "Cache-Control": "no-store" }
	});
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${current}`);
	const range = request.headers.get("Range");
	if (range) headers.set("Range", range);
	try {
		return passThrough(await fetchImpl(driveMediaUrl(fileId), {
			method: request.method,
			headers,
			cache: "no-store",
			redirect: "follow",
			mode: "cors"
		}), request.method);
	} catch {
		return new Response("Chart could not reach Drive for this file.", {
			status: 502,
			headers: { "Cache-Control": "no-store" }
		});
	}
}
function passThrough(response, method) {
	const headers = new Headers();
	for (const name of PASS_HEADERS) {
		const value = response.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set("Cache-Control", "no-store");
	return new Response(method === "HEAD" ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
//#endregion
//#region src/sw/chart-sw.ts
/**
* Attaches the Google sign-in and forwards range reads for /chart-media/<file id>.
* WAV bytes are Drive's response. This worker does not cache them or re-encode them.
*/
const scope = globalThis;
let token = null;
scope.addEventListener("install", (event) => {
	event.waitUntil?.(scope.skipWaiting());
});
scope.addEventListener("activate", (event) => {
	event.waitUntil?.(scope.clients.claim());
});
scope.addEventListener("message", (event) => {
	if (event.data?.type !== "chart-token") return;
	token = normalizeToken(event.data.token);
});
scope.addEventListener("fetch", (event) => {
	const request = event.request;
	if (!request || !mediaFileId(request.url) || !event.respondWith) return;
	event.respondWith(forwardWav(request, token));
});
//#endregion
