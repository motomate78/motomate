import { useState, useCallback } from 'react';

/**
 * Hook для получения предложений адресов через Яндекс.Suggest API
 * @param {string} yandexMapsKey - API ключ Яндекс.Карт
 * @returns {Object} { suggestions, loading, error, searchAddresses }
 */
export function useAddressSuggest(yandexMapsKey) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const searchAddresses = useCallback(async (query, city = '') => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Формируем поисковый запрос с городом если указан
      const searchQuery = city ? `${city}, ${query}` : query;
      
      // Используем бэкенд прокси /api/geo/suggest (избегаем CORS)
      const response = await fetch(
        `/api/geo/suggest?text=${encodeURIComponent(searchQuery)}&type=geo&results=8&lang=ru_RU`
      );

      let addresses = [];
      if (response.ok) {
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) {
          addresses = data.results.map((item) => ({
            title: item.text ? item.text.split(', ')[0] : '',
            subtitle: item.text ? item.text.split(', ').slice(1).join(', ') : '',
            fullAddress: item.text || '',
            type: 'geo',
          })).filter((item) => item.title);
        }
      }

      if (addresses.length === 0) {
        const osmResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&accept-language=ru&q=${encodeURIComponent(searchQuery)}`
        );
        if (osmResponse.ok) {
          const osmData = await osmResponse.json();
          addresses = (Array.isArray(osmData) ? osmData : []).map((item) => {
            const address = item?.address || {};
            const title = address.road || address.pedestrian || address.neighbourhood || item?.name || item?.display_name?.split(',')?.[0] || '';
            const subtitle = [address.city || address.town || address.village || address.state, address.country].filter(Boolean).join(', ');
            const fullAddress = item?.display_name || [title, subtitle].filter(Boolean).join(', ');
            return { title, subtitle, fullAddress, type: 'geo' };
          }).filter((item) => item.title || item.fullAddress);
        }
      }

      setSuggestions(addresses);
    } catch (err) {
      console.error('Address suggest error:', err);
      setError('Ошибка при поиске адресов');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const geocodeAddress = useCallback(async (address, city = '') => {
    try {
      const searchText = city ? `${city}, ${address}` : address;

      if (yandexMapsKey) {
        const response = await fetch(
          `https://geocode-maps.yandex.ru/1.x/?apikey=${yandexMapsKey}&geocode=${encodeURIComponent(searchText)}&format=json&rspn=1`
        );

        if (response.ok) {
          const data = await response.json();
          const features = data?.response?.GeoObjectCollection?.featureMember;
          if (features && features.length > 0) {
            const feature = features[0].GeoObject;
            const [lon, lat] = feature.Point.pos.split(' ');
            return {
              address: feature.metaDataProperty.GeocoderMetaData.text,
              lat: parseFloat(lat),
              lon: parseFloat(lon),
            };
          }
        }
      }

      const osmResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(searchText)}`
      );
      if (osmResponse.ok) {
        const osmData = await osmResponse.json();
        const first = Array.isArray(osmData) ? osmData[0] : null;
        if (first) {
          return {
            address: first.display_name || searchText,
            lat: parseFloat(first.lat),
            lon: parseFloat(first.lon),
          };
        }
      }

      return null;
    } catch (err) {
      console.error('Geocoding error:', err);
      return null;
    }
  }, [yandexMapsKey]);

  return { suggestions, loading, error, searchAddresses, geocodeAddress };
}
