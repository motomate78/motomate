import React, { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_CENTER = [55.751244, 37.618423]; // Москва

function parseCoord(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function ensureYmaps(apiKey) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Нет window'));
  if (window.ymaps?.ready) return Promise.resolve(window.ymaps);

  const existing = document.querySelector('script[data-ymaps="1"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.ymaps));
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить Яндекс.Карты')));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.dataset.ymaps = '1';
    script.async = true;
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.onload = () => resolve(window.ymaps);
    script.onerror = () => reject(new Error('Не удалось загрузить Яндекс.Карты'));
    document.head.appendChild(script);
  });
}

export default function EventsMap({ userData, bikers = [], events = [] }) {
  const apiKey = import.meta.env.VITE_YANDEX_API_KEY;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const geoRef = useRef(null);
  const clusterRef = useRef(null);
  const myRef = useRef(null);
  const eventCoordsCacheRef = useRef(new Map());
  const [loadError, setLoadError] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [geocodedEventCoords, setGeocodedEventCoords] = useState({});

  const center = useMemo(() => {
    const lat = parseCoord(userData?.latitude);
    const lng = parseCoord(userData?.longitude);
    if (lat != null && lng != null) return [lat, lng];
    return DEFAULT_CENTER;
  }, [userData?.latitude, userData?.longitude]);

  useEffect(() => {
    let cancelled = false;
    if (!apiKey || events.length === 0) return;

    ensureYmaps(apiKey)
      .then((ymaps) => new Promise((resolve) => ymaps.ready(resolve)).then(() => ymaps))
      .then(async (ymaps) => {
        const unresolved = events.filter((event) => {
          const lat = parseCoord(event?.latitude);
          const lng = parseCoord(event?.longitude);
          const cacheKey = `${event?.id || ''}:${event?.address || ''}`;
          return (lat == null || lng == null) && Boolean(event?.address) && !eventCoordsCacheRef.current.has(cacheKey);
        });
        if (unresolved.length === 0 || cancelled) return;

        const pairs = await Promise.all(unresolved.map(async (event) => {
          const cacheKey = `${event?.id || ''}:${event?.address || ''}`;
          try {
            const geoResult = await ymaps.geocode(event.address, { results: 1 });
            const first = geoResult.geoObjects.get(0);
            const coords = first?.geometry?.getCoordinates?.();
            const lat = parseCoord(coords?.[0]);
            const lng = parseCoord(coords?.[1]);
            if (lat != null && lng != null) return [cacheKey, { latitude: lat, longitude: lng }];
            return [cacheKey, null];
          } catch {
            return [cacheKey, null];
          }
        }));

        if (cancelled) return;
        const patch = {};
        for (const [key, coords] of pairs) {
          eventCoordsCacheRef.current.set(key, coords);
          if (coords) patch[key] = coords;
        }
        if (Object.keys(patch).length > 0) {
          setGeocodedEventCoords((prev) => ({ ...prev, ...patch }));
        }
      })
      .catch(() => {
        // No-op: map loading errors are handled in map init effect.
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, events]);

  const objects = useMemo(() => {
    const pts = [];
    const myLat = parseCoord(userData?.latitude);
    const myLng = parseCoord(userData?.longitude);
    if (myLat != null && myLng != null) pts.push({ type: 'me', id: 'me', lat: myLat, lng: myLng });

    for (const b of bikers) {
      const lat = parseCoord(b?.latitude);
      const lng = parseCoord(b?.longitude);
      if (lat == null || lng == null) continue;
      pts.push({ type: 'biker', id: `b_${b.id}`, lat, lng, title: b?.name });
    }

    for (const e of events) {
      let lat = parseCoord(e?.latitude);
      let lng = parseCoord(e?.longitude);
      if (lat == null || lng == null) {
        const cacheKey = `${e?.id || ''}:${e?.address || ''}`;
        const fallbackCoords = geocodedEventCoords[cacheKey];
        lat = parseCoord(fallbackCoords?.latitude);
        lng = parseCoord(fallbackCoords?.longitude);
      }
      if (lat == null || lng == null) continue;
      pts.push({ type: 'event', id: `e_${e.id}`, lat, lng, title: e?.title });
    }
    return pts;
  }, [userData?.latitude, userData?.longitude, bikers, events, geocodedEventCoords]);

  useEffect(() => {
    let cancelled = false;
    
    // Reset error state synchronously at the start
    if (loadError !== null) {
      setLoadError(null);
    }

    if (!apiKey) return;
    if (!containerRef.current) return;

    ensureYmaps(apiKey)
      .then((ymaps) => {
        if (cancelled) return;
        ymaps.ready(() => {
          if (cancelled) return;

          if (!mapRef.current) {
            mapRef.current = new ymaps.Map(containerRef.current, {
              center,
              zoom: 11,
              controls: ['zoomControl'],
            }, {
              suppressMapOpenBlock: true,
            });
            geoRef.current = new ymaps.GeoObjectCollection();
            clusterRef.current = new ymaps.Clusterer({
              preset: 'islands#invertedVioletClusterIcons',
              groupByCoordinates: false,
              clusterDisableClickZoom: false,
              clusterOpenBalloonOnClick: false,
            });
            mapRef.current.geoObjects.add(clusterRef.current);
            mapRef.current.geoObjects.add(geoRef.current);
            setIsReady(true);
          } else {
            mapRef.current.setCenter(center, 11, { duration: 200 });
          }

          // repaint placemarks
          if (geoRef.current) geoRef.current.removeAll();
          if (clusterRef.current) clusterRef.current.removeAll();

          for (const o of objects) {
            if (o.type === 'me') {
              const pm = new ymaps.Placemark([o.lat, o.lng], { hintContent: 'Вы здесь' }, { preset: 'islands#orangeCircleDotIcon' });
              myRef.current = pm;
              geoRef.current.add(pm);
              continue;
            }
            const preset = o.type === 'event' ? 'islands#redIcon' : 'islands#blueMotorcycleIcon';
            const pm = new ymaps.Placemark([o.lat, o.lng], {
              hintContent: o.title || (o.type === 'event' ? 'Событие' : 'Байкер'),
            }, { preset });
            clusterRef.current.add(pm);
          }
        });
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e?.message || 'Ошибка загрузки карты');
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, center, objects]);

  // Обработка изменения размера контейнера
  useEffect(() => {
    if (!mapRef.current || !isReady) return;
    
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.container.fitToViewport();
      }
    };

    window.addEventListener('resize', handleResize);
    // Вызываем сразу после монтирования/обновления
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isReady]);

  if (!apiKey) {
    return (
      <div className="h-full w-full rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <p className="text-sm text-zinc-300 font-bold uppercase tracking-widest">Карта</p>
        <p className="text-xs text-zinc-500 mt-3">
          Не задан ключ Яндекс.Карт. Добавьте <span className="text-orange-500 font-bold">VITE_YANDEX_API_KEY</span> в .env.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full w-full rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl p-6">
        <p className="text-sm text-zinc-300 font-bold uppercase tracking-widest">Карта</p>
        <p className="text-xs text-red-400 mt-3">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full rounded-[32px] overflow-hidden border border-white/10 bg-white/5 backdrop-blur-xl">
      {!isReady && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/5 to-white/0 pointer-events-none" />
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

