import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAddressSuggest } from '../hooks/useAddressSuggest';

/**
 * Autocomplete для адресов, использует Яндекс.Suggest API
 */
export function AddressAutocomplete({
  value,
  onChange,
  city = '',
  yandexMapsKey = import.meta.env.VITE_YANDEX_API_KEY,
  placeholder = 'Адрес события...'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const { suggestions, loading, searchAddresses, geocodeAddress } = useAddressSuggest(yandexMapsKey);

  const handleInputChange = (e) => {
    const text = e.target.value;
    setQuery(text);
    onChange({ address: text, coordinates: null });

    // Debounce поиск
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (text.length > 1) {
      debounceTimerRef.current = setTimeout(() => {
        searchAddresses(text, city);
        setIsOpen(true);
      }, 300);
    } else {
      setIsOpen(false);
    }
  };

  const handleSelectAddress = useCallback(async (suggestion) => {
    const fullAddress = suggestion.fullAddress || suggestion.title;
    
    // Пытаемся получить координаты выбранного адреса
    const geocoded = await geocodeAddress(fullAddress, city);
    
    onChange({
      address: fullAddress,
      coordinates: geocoded ? { lat: geocoded.lat, lon: geocoded.lon } : null,
    });
    
    setQuery('');
    setIsOpen(false);
  }, [city, geocodeAddress, onChange]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!inputRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const displayValue = typeof value === 'string' ? value : value?.address || '';

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={query || displayValue}
        onChange={handleInputChange}
        onFocus={() => {
          if (query || displayValue) {
            setIsOpen(true);
          }
        }}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white rounded-lg focus:outline-none focus:border-orange-500 transition text-sm"
      />

      {loading && (
        <div className="absolute right-3 top-2.5">
          <div className="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full" />
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectAddress(suggestion)}
              className="w-full px-4 py-3 text-left text-white hover:bg-orange-500/20 transition text-sm border-b border-zinc-800 last:border-b-0 flex flex-col gap-0.5"
            >
              <span className="font-medium">{suggestion.title}</span>
              {suggestion.subtitle && (
                <span className="text-xs text-zinc-400">{suggestion.subtitle}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && suggestions.length === 0 && !loading && query && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg p-4 text-center text-sm text-zinc-400"
        >
          Адреса не найдены
        </div>
      )}
    </div>
  );
}
