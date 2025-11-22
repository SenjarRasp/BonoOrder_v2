// sw.js - Service Worker для Restaurant Orders
const CACHE_NAME = 'restaurant-orders-v4';
const urlsToCache = [
  '/BonoOrder/',
  '/BonoOrder/index.html',
  '/BonoOrder/styles.css',
  '/BonoOrder/app.js',
  '/BonoOrder/manifest.json'
];

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing');
  self.skipWaiting(); // Принудительная активация
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating new version');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Немедленно завладеваем всеми клиентами
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Для API запросов - всегда сеть
  if (event.request.url.includes('script.google.com')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    // Обработка ошибок сети
                    return new Response(JSON.stringify({
                        status: 'error',
                        message: 'Отсутствует подключение к интернету'
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
        );
        return;
    }

  // Для статических файлов - кэш сначала, потом сеть
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request)
          .then((response) => {
            // Кэшируем только успешные ответы
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            return response;
          });
      })
  );
});



