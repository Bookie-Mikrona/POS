// Minimalni service worker: omogoči namestitev aplikacije, ne shranjuje ničesar.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
