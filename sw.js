// Picture Portal background helper.
// - Lets the site be added to the home screen as an app.
// - Caches nothing, so everyone always gets the latest pages and photos.
// - Background sending: photos a guest added are saved on their phone first. If they close
//   the page before everything has gone, this finishes sending when there's signal
//   (where the phone supports it — most Android phones with Chrome do).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate" && new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(fetch(e.request));
  }
});

self.addEventListener("sync", (e) => {
  if (e.tag === "portal-upload") e.waitUntil(sendSaved());
});

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("picture-portal", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "path" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function run(db, store, mode, op) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => res(req.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

async function sendSaved() {
  const db = await openDb();
  const cfg = await run(db, "meta", "readonly", (s) => s.get("config"));
  if (!cfg) return;
  const recs = (await run(db, "queue", "readonly", (s) => s.getAll())) || [];
  let retryLater = false;
  for (const r of recs) {
    try {
      const url = `${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${r.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": r.type || "image/jpeg", "x-upsert": "false" },
        body: r.blob
      });
      const text = res.ok ? "" : await res.text().catch(() => "");
      if (res.ok || res.status === 409 || /duplicate|already exists/i.test(text)) {
        await run(db, "queue", "readwrite", (s) => s.delete(r.path));
        await makeCopies(cfg, r).catch(() => {});
      } else if (res.status >= 500 || res.status === 408 || res.status === 429) {
        retryLater = true;
      }
      // Other refusals (e.g. not a photo) are left for the page to show next time it opens.
    } catch (err) {
      retryLater = true; // still no signal
    }
  }
  if (retryLater) throw new Error("Will try again when there is signal");
}

// Small preview + screen-size copies for the organiser and family gallery (best effort).
async function makeCopies(cfg, r) {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return;
  const bmp = await createImageBitmap(r.blob, { imageOrientation: "from-image" });
  const base = r.path.split("/").pop().replace(/\.[^.]+$/, "");
  const folder = r.path.split("/")[0];
  try {
    for (const [sub, edge, q] of [["_thumbs", 640, 0.72], ["_display", 1600, 0.82]]) {
      const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
      const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: q });
      await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${folder}/${sub}/${encodeURIComponent(base)}.jpg`, {
        method: "POST",
        headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "image/jpeg", "x-upsert": "false" },
        body: blob
      });
    }
  } finally {
    if (bmp.close) bmp.close();
  }
}
