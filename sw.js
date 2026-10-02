// Service worker: guarda o app no aparelho para abrir sem internet.
const VERSAO = "v1.3.3";
const CACHE = "vistoria-" + VERSAO;
const ARQUIVOS = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.webmanifest",
  "./vendor/supabase.js", "./vendor/jszip.min.js",
  "./fonts/montserrat-latin-400-normal.woff2", "./fonts/montserrat-latin-600-normal.woff2", "./fonts/montserrat-latin-700-normal.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase e outros: sempre direto na rede
  // app: usa o que está guardado e atualiza em segundo plano
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const guardado = await c.match(req, { ignoreSearch: true });
    const rede = fetch(req).then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return guardado || (await rede) || (req.mode === "navigate" ? c.match("./index.html") : Response.error());
  }));
});
