import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const LegalModal = ({ isOpen, onClose, docType }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const docInfo = {
    privacy: {
      title: 'Политика конфиденциальности',
      file: '/privacy-policy.txt',
    },
    cookies: {
      title: 'Политика использования Cookie',
      file: '/cookie-policy.txt',
    },
    license: {
      title: 'Лицензионное соглашение',
      file: '/license-agreement.txt',
    },
  };

  useEffect(() => {
    if (isOpen && docType && docInfo[docType]) {
      loadDocument();
    }
  }, [isOpen, docType]);

  const loadDocument = async () => {
    setLoading(true);
    try {
      const response = await fetch(docInfo[docType]?.file);
      const text = await response.text();
      setContent(text);
    } catch (error) {
      console.error('Error loading document:', error);
      setContent('Не удалось загрузить документ');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !docType || !docInfo[docType]) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-black/90 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">{docInfo[docType]?.title}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} className="text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="text-zinc-400">Загрузка документа...</div>
            </div>
          ) : (
            <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-6 bg-black/50">
          <button
            onClick={onClose}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};

export default LegalModal;
