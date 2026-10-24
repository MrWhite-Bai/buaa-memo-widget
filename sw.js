const CACHE_NAME = "buaa-memo-cloud-20261024195013";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./changelog.json",
  "./starry-sky-v2.jpg",
  "./river-material-v3.jpg",
  "./mobile-download-qr.png",
  "./assets/katex/fonts/KaTeX_AMS-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Caligraphic-Bold.woff2",
  "./assets/katex/fonts/KaTeX_Caligraphic-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Fraktur-Bold.woff2",
  "./assets/katex/fonts/KaTeX_Fraktur-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Main-Bold.woff2",
  "./assets/katex/fonts/KaTeX_Main-BoldItalic.woff2",
  "./assets/katex/fonts/KaTeX_Main-Italic.woff2",
  "./assets/katex/fonts/KaTeX_Main-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Math-BoldItalic.woff2",
  "./assets/katex/fonts/KaTeX_Math-Italic.woff2",
  "./assets/katex/fonts/KaTeX_SansSerif-Bold.woff2",
  "./assets/katex/fonts/KaTeX_SansSerif-Italic.woff2",
  "./assets/katex/fonts/KaTeX_SansSerif-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Script-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Size1-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Size2-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Size3-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Size4-Regular.woff2",
  "./assets/katex/fonts/KaTeX_Typewriter-Regular.woff2",
  "./assets/katex/katex.min.css",
  "./assets/katex/katex.min.js",
  "./assets/katex/LICENSE",
  "./assets/fonts/buaa-hei.woff2",
  "./assets/fonts/buaa-kai.woff2",
  "./assets/fonts/buaa-shoujin.woff2",
  "./assets/fonts/buaa-song.woff2",
  "./assets/fonts/LICENSE-LXGWWenKaiLite.txt",
  "./assets/fonts/LICENSE-Shoujin.txt",
  "./assets/fonts/LICENSE-SmileySans.txt",
  "./assets/fonts/LICENSE-ZCOOLXiaoWei.txt",
  "./assets/fonts/README.txt",
  "./assets/badge-art/beta.svg",
  "./assets/badge-art/bloom.svg",
  "./assets/badge-art/ember.svg",
  "./assets/badge-art/gold.svg",
  "./assets/badge-art/ink.svg",
  "./assets/badge-art/jade.svg",
  "./assets/badge-art/labyrinth.svg",
  "./assets/badge-art/leaf.svg",
  "./assets/badge-art/LICENSE.md",
  "./assets/badge-art/moon.svg",
  "./assets/badge-art/moonrise.svg",
  "./assets/badge-art/orbit.svg",
  "./assets/badge-art/prism.svg",
  "./assets/badge-art/star.svg",
  "./assets/badge-art/sun.svg",
  "./assets/badge-art/tide.svg",
  "./icon-192.png",
  "./icon-180.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached || caches.match("./index.html");
      })
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
