import React, { useState, useRef, useEffect } from 'react';

/**
 * Autocomplete для адресов, использует Яндекс.Геокодер
 */
export function AddressAutocomplete({
  value,
  onChange,
  city = '',
  yandexMapsKey = import.meta.env.VITE_YANDEX_API_KEY,
  placeholder = 'Адрес события...'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const searchAddresses = async (query) => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    
    try {
      const searchText = city ? `${city}, ${query}` : query;
      
      const response = await fetch(
        `https://geocode-maps.yandex.ru/1.x/?apikey=${yandexMapsKey}&geocode=${encodeURIComponent(searchText)}&format=json&results=5`
      );

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      const features = data.response.GeoObjectCollection.featureMember || [];

      const results = features.map((feature) => ({
        name: feature.GeoObject.metaDataProperty.GeocoderMetaData.text,
        coords: feature.GeoObject.Point.pos.split(' ').reverse(),
      }));

      setSuggestions(results);
      setIsOpen(results.length > 0);
    } catch (error) {
      console.error('Address search error:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const text = e.target.value;
    onChange({ address: text, coordinates: null });
    searchAddresses(text);
  };

  const handleSelectAddress = (suggestion) => {
    onChange({
      address: suggestion.name,
      coordinates: {
        lat: parseFloat(suggestion.coords[0]),
        lon: parseFloat(suggestion.coords[1]),
      },
    });
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
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const displayValue = typeof value === 'string' ? value : value?.address || '';

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={() => displayValue.length > 0 && setSuggestions.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white rounded-lg focus:outline-none focus:border-orange-500 transition"
      />

      {loading && (
        <div className="absolute right-3 top-2.5">
          <div className="animate-spin h-5 w-5 border-2 border-orange-500 border-t-transparent rounded-full" />
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {suggestions.map((suggestion, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectAddress(suggestion)}
              className="w-full px-3 py-2 text-left text-white hover:bg-orange-500/20 transition text-sm"
            >
              📍 {suggestion.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
