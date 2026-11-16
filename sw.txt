// ═══════════════════════════════════════════════════════════════════════════
// PROVATIO — Service worker
//
// Hace dos cosas:
//
// 1. Que Provatio se pueda INSTALAR en el teléfono. Sin este archivo el
//    navegador no ofrece "Agregar a pantalla de inicio" como app.
//
// 2. Que la app ABRA sin internet. Guarda el HTML y los íconos; si no hay
//    señal, levanta igual con lo último que se descargó. Los DATOS son otra
//    cosa: de eso se encarga la persistencia de Firestore, que los guarda en
//    el teléfono y los sube cuando vuelve la señal.
//
// ESTRATEGIA: red primero, caché como red de emergencia. Provatio cambia
// seguido y un caché agresivo dejaría a un cliente con una versión vieja sin
// saber por qué. Se prefiere pedir a la red siempre y usar el caché solo
// cuando la red no contesta.
// ═══════════════════════════════════════════════════════════════════════════

// LA ETIQUETA DE VERSIÓN. Subirle el número obliga a todos los teléfonos a
// tirar la copia vieja y bajarse la nueva. Se cambia cuando se sube un arreglo
// que tiene que llegar sí o sí, sin depender de que cada uno cierre la app.
// v2 — 30/8/2026: arreglo de la operación fantasma.
// v3 — 15/11/2026: arranque de Firestore en orden y recuperación automática
//      cuando la base queda inutilizable. Tiene que llegar sí o sí: la versión
//      vieja deja la app sin abrir en el primer intento.
// v4 — 16/11/2026: el HTML se pide SIEMPRE a la red de verdad, salteando la
//      caché del navegador. Pedirlo normal no alcanzaba: GitHub Pages manda el
//      index.html con permiso de guardarlo diez minutos, y en la app instalada
//      no existe Ctrl+Shift+R. Resultado: se subía un arreglo y se seguía
//      usando el archivo viejo, sin forma de saberlo ni de evitarlo.
const CACHE = 'provatio-v4';
const ESENCIALES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', e => {
  // addAll falla entero si UN archivo no está. Se agregan de a uno para que
  // un ícono faltante no impida la instalación.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ESENCIALES.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Nada de otros dominios pasa por acá: Firestore, la API de la IA y las
  // fuentes manejan su propia conexión. Meterse en el medio rompería la
  // sincronización offline de Firestore, que ya sabe hacer su trabajo.
  if (url.origin !== self.location.origin) return;

  // EL HTML, SIEMPRE FRESCO. `cache: 'reload'` obliga al navegador a ir a la
  // red aunque su copia todavía figure como vigente. Para el resto (íconos,
  // manifiesto) se usa el pedido normal: no cambian y no vale la pena.
  const esPagina = req.mode === 'navigate' || /\/(index\.html)?(\?|$)/.test(url.pathname + url.search);
  const pedido = esPagina ? fetch(req, { cache: 'reload' }) : fetch(req);

  e.respondWith(
    pedido
      .then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const enCache = await caches.match(req);
        if (enCache) return enCache;
        // Navegación sin señal y sin copia: se devuelve la portada guardada.
        if (req.mode === 'navigate') {
          const inicio = await caches.match('/index.html') || await caches.match('/');
          if (inicio) return inicio;
        }
        return new Response('Sin conexión', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
