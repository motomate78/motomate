import { useState, useEffect, useCallback } from 'react';

/**
 * Hook для получения геолокации пользователя и определения города
 * @param {string} yandexMapsKey - API ключ Яндекс.Карт
 * @param {boolean} autoRequest - Автоматически запросить геолокацию при загрузке (по умолчанию false)
 * @returns {Object} { city, coordinates, loading, error, retry, requestGeolocation }
 */
export function useGeolocation(yandexMapsKey, autoRequest = false) {
  const [city, setCity] = useState('');
  const [coordinates, setCoordinates] = useState(null);
  const [loading, setLoading] = useState(autoRequest);
  const [error, setError] = useState(null);

  const getCity = async (lat, lon) => {
    try {
      // Используем Яндекс.Геокодер для обратного геокодинга
      const response = await fetch(
        `https://geocode-maps.yandex.ru/1.x/?apikey=${yandexMapsKey}&geocode=${lon},${lat}&format=json`
      );
      
      if (!response.ok) throw new Error('Geocoding failed');
      
      const data = await response.json();
      const featureMember = data.response.GeoObjectCollection.featureMember[0];
      
      if (featureMember) {
        const addressDetails = featureMember.GeoObject.metaDataProperty.GeocoderMetaData.AddressDetails;
        
        // Пытаемся найти город
        let cityName = '';
        
        // Проверяем иерархию: Страна -> Адм.область -> Город -> Город/Область
        if (addressDetails.Country.AdministrativeArea?.Locality?.LocalityName) {
          cityName = addressDetails.Country.AdministrativeArea.Locality.LocalityName;
        } else if (addressDetails.Country.AdministrativeArea?.LocalityName) {
          cityName = addressDetails.Country.AdministrativeArea.LocalityName;
        } else if (addressDetails.Country.Locality?.LocalityName) {
          cityName = addressDetails.Country.Locality.LocalityName;
        }
        
        if (cityName) {
          setCity(cityName);
          setCoordinates({ lat, lon });
          setError(null);
        } else {
          setError('Город не определен');
        }
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setError('Ошибка определения города');
    } finally {
      setLoading(false);
    }
  };

  const requestGeolocation = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        getCity(latitude, longitude);
      },
      (err) => {
        console.error('Geolocation error:', err);
        setError('Разрешите доступ к геолокации в настройках браузера');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [yandexMapsKey]);

  // Опциональный автоматический запрос при загрузке компонента
  useEffect(() => {
    if (autoRequest) {
      requestGeolocation();
    }
  }, [autoRequest, requestGeolocation]);

  const retry = useCallback(() => {
    setCity('');
    setCoordinates(null);
    requestGeolocation();
  }, [requestGeolocation]);

  return { city, coordinates, loading, error, retry, requestGeolocation, setCity };
}
