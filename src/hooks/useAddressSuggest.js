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
      
      // Используем Suggest API для получения адресов и мест
      const response = await fetch(
        `https://suggest-maps.yandex.ru/v1/suggest?apikey=${yandexMapsKey}&text=${encodeURIComponent(searchQuery)}&types=geo&lang=ru`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Suggest API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.results && Array.isArray(data.results)) {
        // Преобразуем результаты в нужный формат
        const addresses = data.results.map((item) => ({
          title: item.title.text,
          subtitle: item.subtitle ? item.subtitle.text : '',
          fullAddress: item.title.text + (item.subtitle ? `, ${item.subtitle.text}` : ''),
          type: item.type || 'geo',
        }));
        
        setSuggestions(addresses);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Address suggest error:', err);
      setError('Ошибка при поиске адресов');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [yandexMapsKey]);

  const geocodeAddress = useCallback(async (address, city = '') => {
    try {
      const searchText = city ? `${city}, ${address}` : address;
      
      const response = await fetch(
        `https://geocode-maps.yandex.ru/1.x/?apikey=${yandexMapsKey}&geocode=${encodeURIComponent(searchText)}&format=json&rspn=1`
      );

      if (!response.ok) throw new Error('Geocoding failed');

      const data = await response.json();
      const features = data.response.GeoObjectCollection.featureMember;

      if (features && features.length > 0) {
        const feature = features[0].GeoObject;
        const [lon, lat] = feature.Point.pos.split(' ');
        return {
          address: feature.metaDataProperty.GeocoderMetaData.text,
          lat: parseFloat(lat),
          lon: parseFloat(lon),
        };
      }

      return null;
    } catch (err) {
      console.error('Geocoding error:', err);
      return null;
    }
  }, [yandexMapsKey]);

  return { suggestions, loading, error, searchAddresses, geocodeAddress };
}
