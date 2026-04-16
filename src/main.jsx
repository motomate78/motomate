import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// import { apiClient } from './apiClient'

// Регистрация Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
        
        // Push уведомления временно отключены для отладки входа
        /*
        if ('Notification' in window && 'PushManager' in window) {
          Notification.requestPermission().then(async permission => {
            if (permission === 'granted') {
              console.log('Notification permission granted');
              
              try {
                const subscription = await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlB64ToUint8Array('BJjpNkIbnYXoftgL755_wE_IeooVx-pN-Pl_nZM7UpQ_TpUl1tNACNdPBr3q5MqzfdFxoLcW8aIQq8TE8a_ddbE')
                });
                
                console.log('Push subscription:', subscription);
                await savePushSubscription(subscription);
              } catch (err) {
                console.log('Push subscription error: ', err);
              }
            }
          });
        }
        */
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

// Функция для конвертации VAPID ключа
// function urlB64ToUint8Array(base64String) {
//   const padding = '='.repeat((4 - base64String.length % 4) % 4);
//   const base64 = (base64String + padding)
//     .replace(/-/g, '+')
//     .replace(/_/g, '/');

//   const rawData = window.atob(base64);
//   const outputArray = new Uint8Array(rawData.length);

//   for (let i = 0; i < rawData.length; ++i) {
//     outputArray[i] = rawData.charCodeAt(i);
//   }
//   return outputArray;
// }

// Функция для сохранения подписки
// async function savePushSubscription(subscription) {
//   try {
//     const userId = localStorage.getItem('userId');
//     if (!userId) {
//       console.log('User not logged in, skipping subscription save');
//       return;
//     }

//     await apiClient.subscribePush(subscription);
//     console.log('Push subscription saved successfully');
//   } catch (error) {
//     console.error('Ошибка сохранения push-подписки:', error);
//   }
// }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
