import React, { useState, useRef, useEffect } from 'react';

/**
 * Autocomplete компонент для выбора города через Yandex Suggest API
 * Ищет реальные города в реальном времени
 */
export function CityAutocomplete({ value, onChange, placeholder = 'Введи свой город...' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tempCity, setTempCity] = useState(value); // Локальное состояние для ввода
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceTimeoutRef = useRef(null);

  // Синхронизируем tempCity когда value меняется извне (например при загрузке профиля)
  useEffect(() => {
    setTempCity(value);
  }, [value]);

  const fetchCities = async (query) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      // Используем бэкенд прокси вместо прямого вызова Яндекса (избегаем CORS)
      const response = await fetch(
        `/api/geo/suggest?text=${encodeURIComponent(query)}&type=geo&results=8&lang=ru_RU`
      );

      if (response.ok) {
        const data = await response.json();
        // Берём текст напрямую из результатов Yandex API
        const results = (data?.results || [])
          .map((item) => String(item?.text || '').trim())
          .filter(Boolean)
          .filter((city, idx, arr) => arr.indexOf(city) === idx)
          .slice(0, 8);
        
        setSuggestions(results);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      console.error('Error fetching cities:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const text = e.target.value;
    setTempCity(text); // Обновляем только локальное состояние

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (text.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    setIsOpen(true); // Открываем dropdown при печати
    debounceTimeoutRef.current = setTimeout(() => {
      fetchCities(text);
    }, 300);
  };

  const handleSelectCity = (city) => {
    setTempCity(city); // Обновляем локальное состояние
    onChange(city); // Вызываем onChange только при выборе из dropdown
    setIsOpen(false);
    setSuggestions([]);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!inputRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={tempCity}
        onChange={handleInputChange}
        onFocus={() => tempCity.length > 0 && suggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white rounded-lg focus:outline-none focus:border-orange-500 transition"
      />

      {isOpen && (suggestions.length > 0 || loading) && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {loading ? (
            <div className="px-3 py-2 text-zinc-400 text-sm">Загрузка...</div>
          ) : (
            suggestions.map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => handleSelectCity(city)}
                className="w-full px-3 py-2 text-left text-white hover:bg-orange-500/20 transition"
              >
                {city}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
