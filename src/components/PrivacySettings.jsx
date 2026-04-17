import React from 'react';

const PrivacySettings = ({ userData, setUserData }) => {
  const handleTogglePrivacy = () => {
    const newValue = !userData?.is_private;
    setUserData((prev) => ({ ...prev, is_private: newValue }));
  };

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/10 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-widest text-zinc-500">Приватность</h3>
      <div className="flex justify-between items-center">
        <div>
          <div className="font-bold text-white text-sm">Режим инкогнито</div>
          <div className="text-[10px] text-zinc-500 mt-1">Скрыть мое местоположение на карте</div>
        </div>
        <button
          type="button"
          onClick={handleTogglePrivacy}
          aria-pressed={Boolean(userData?.is_private)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            userData?.is_private ? 'bg-orange-600' : 'bg-zinc-700'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              userData?.is_private ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default PrivacySettings;
