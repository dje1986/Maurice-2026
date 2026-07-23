// Service Worker - Maurice 2026 PWA
// Gère le mode hors ligne : coquille applicative (HTML/CSS/JS/polices/icônes)
// + dernières données connues de l'API Google Apps Script.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `maurice2026-static-${CACHE_VERSION}`;
const DATA_CACHE = `maurice2026-data-${CACHE_VERSION}`;

// Fichiers de l'app à mettre en cache dès l'installation (même origine)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

// Ressources externes (CDN) utilisées par l'app
const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Urbanist:wght@400;500;600;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Hôte de l'API Google Apps Script (lecture des données du voyage)
const API_HOST = 'script.google.com';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      try {
        await cache.addAll(APP_SHELL);
      } catch (err) {
        console.warn('[SW] Précache app shell partiel :', err);
      }
      // Chaque ressource externe est mise en cache indépendamment :
      // si une seule échoue (CORS, réseau...), ça ne bloque pas l'installation.
      await Promise.allSettled(
        EXTERNAL_ASSETS.map((url) =>
          fetch(url)
            .then((resp) => cache.put(url, resp))
            .catch((err) => console.warn('[SW] Précache externe échoué :', url, err))
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Les POST (ajout/coche/suppression checklist, ajout activité...) doivent
  // toujours passer directement sur le réseau : on ne les intercepte jamais.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Données du voyage (Google Apps Script) : réseau prioritaire, cache de secours hors-ligne
  if (url.hostname === API_HOST) {
    event.respondWith(networkFirstData(request, url));
    return;
  }

  // Navigation vers la page principale : réseau prioritaire, cache de secours hors-ligne
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  // Ressources statiques (Tailwind, polices, Leaflet, icônes...) : cache prioritaire
  event.respondWith(cacheFirst(request));
});

async function networkFirstData(request, url) {
  const cache = await caches.open(DATA_CACHE);
  // Clé de cache normalisée : on ignore le paramètre anti-cache "t=timestamp"
  // pour toujours retrouver/écraser la même entrée "dernières données connues".
  const cacheKey = url.origin + url.pathname;

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(cacheKey, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Hors-ligne : aucune donnée en cache pour le moment.' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirstShell(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match('./index.html'));
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    return cached || Response.error();
  }
}
