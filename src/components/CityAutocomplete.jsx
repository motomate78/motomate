import React, { useState, useRef, useEffect } from 'react';

/**
 * Autocomplete компонент для выбора города
 * Список крупных городов России
 */
const CITIES = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург',
  'Нижний Новгород', 'Казань', 'Челябинск', 'Омск',
  'Самара', 'Ростов-на-Дону', 'Уфа', 'Краснодар',
  'Пермь', 'Воронеж', 'Волгоград', 'Кемерово',
  'Тюмень', 'Иркутск', 'Минск', 'Киев',
  'Брест', 'Гродно', 'Витебск', 'Могилев',
  'Берлин', 'Франкфурт', 'Мюнхен', 'Гамбург',
  'Лондон', 'Манчестер', 'Ливерпуль', 'Париж',
  'Марсель', 'Лион', 'Барселона', 'Мадрид',
  'Милан', 'Рим', 'Венеция', 'Амстердам',
  'Бельгия', 'Прага', 'Варшава', 'Будапешт'
];

export function CityAutocomplete({ value, onChange, placeholder = 'Введи свой город...' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState([]);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const handleInputChange = (e) => {
    const text = e.target.value;
    onChange(text);

    if (text.length === 0) {
      setFiltered([]);
      setIsOpen(false);
    } else {
      const results = CITIES.filter((city) =>
        city.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 8);
      setFiltered(results);
      setIsOpen(results.length > 0);
    }
  };

  const handleSelectCity = (city) => {
    onChange(city);
    setIsOpen(false);
    setFiltered([]);
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

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => value.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white rounded-lg focus:outline-none focus:border-orange-500 transition"
      />

      {isOpen && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-2 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {filtered.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => handleSelectCity(city)}
              className="w-full px-3 py-2 text-left text-white hover:bg-orange-500/20 transition"
            >
              {city}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
