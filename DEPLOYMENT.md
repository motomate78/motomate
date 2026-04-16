# 🚀 DEPLOYMENT MotoMate — Автоматическая установка

**Время: ~10 минут (плюс SSL сертификат 5 минут)**

---

## ✅ ПЕРЕД НАЧАЛОМ

- [ ] Аккаунт в Yandex Cloud (https://console.cloud.yandex.ru)
- [ ] Домен куплен и готов (или будете использовать IP)
- [ ] SSH ключ или пароль готов

---

# ЭТАП 1: Создание VM в Yandex Cloud

## Шаг 1.1: Создание облачной сети

1. Откройте https://console.cloud.yandex.ru
2. В левом меню → **VPC Network** → **Networks**
3. Нажмите **Create network**
4. Имя: `motomate-network`
5. **Create subnet**:
   - **Name**: `motomate-subnet`
   - **Zone**: `ru-central1-a`
   - **CIDR**: `10.0.1.0/24`
6. **Create**

✅ **Сеть готова!**

---

## Шаг 1.2: Открытие портов (Security Groups)

1. **VPC Network** → **Security Groups**
2. Нажмите на группу вашей VM или создайте новую
3. **Ingress rules** — добавьте:

| Protocol | Port | Source | Назначение |
|----------|------|--------|-----------|
| TCP | 22 | 0.0.0.0/0 | SSH |
| TCP | 80 | 0.0.0.0/0 | HTTP → HTTPS |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

✅ **Порты открыты!**

---

## Шаг 1.3: Создание VM

1. **Compute Cloud** → **Virtual machines** → **Create instance**
2. **Базовые параметры:**
   - **Name**: `motomate`
   - **Zone**: `ru-central1-a`
   - **OS Image**: `Ubuntu 22.04 LTS`

3. **Вычисляемые ресурсы:**
   - **CPU**: 2-4 cores
   - **RAM**: 4-8 GB
   - **Disk**: 30-50 GB SSD

4. **Сеть:**
   - **Network**: `motomate-network`
   - **Subnet**: `motomate-subnet`
   - **Public IP**: ✅ (да)

5. **SSH keys** (если есть) — добавьте публичный ключ

6. **Create**

⏳ Дождитесь (обычно 30 секунд)

✅ **VM готова! Скопируйте публичный IP адрес!**

---

# ЭТАП 2: SSH подключение

## На Mac/Linux:

```bash
# Замените на ваш IP
ssh ubuntu@YOUR_PUBLIC_IP
```

## На Windows (PuTTY):

- **Host**: `YOUR_PUBLIC_IP`
- **Port**: 22
- **User**: `ubuntu`
- **Auth**: используйте ваш SSH ключ

---

# ЭТАП 3: Запуск автоматического деплоя (ВСЕ В ОДНОЙ КОМАНДЕ!)

Когда подключились, выполните:

```bash
# Скачиваем и запускаем скрипт
curl -fsSL https://raw.githubusercontent.com/motomate78/motomate/main/deploy-yandex.sh | sudo bash
```

**Если вы клонировали репозиторий локально:**

```bash
# Или так (если уже скачали файлы)
sudo bash ~/motomate/deploy-yandex.sh https://github.com/motomate78/motomate.git
```

---

## Что происходит:

Скрипт автоматически:

✅ Обновляет систему (Ubuntu packages)  
✅ Устанавливает Docker & Docker Compose  
✅ Устанавливает Node.js 20  
✅ Клонирует ваш репозиторий  
✅ Запускает контейнеры (PostgreSQL, Backend, Frontend)  
✅ Применяет Prisma миграции  
✅ Устанавливает Nginx  
✅ Настраивает обратный прокси  
✅ Устанавливает SSL (Let's Encrypt)  
✅ Настраивает автоматические резервные копии  

---

## Во время выполнения скрипта:

### Шаг 6: Настройка .env

Скрипт попросит отредактировать `.env`:

```bash
nano /home/ubuntu/motomate/.env
```

**ОБЯЗАТЕЛЬНО заполните:**

```env
POSTGRES_PASSWORD=STRONG_PASSWORD_HERE
JWT_SECRET=random-32-char-string-here
CORS_ORIGINS=https://yourdomain.com,http://localhost:8080
YANDEX_CLIENT_ID=your_id (опционально)
YANDEX_CLIENT_SECRET=your_secret (опционально)
VITE_YANDEX_API_KEY=your_api_key (опционально)
```

Сохраните: **CTRL+X, Y, Enter**

Затем просто нажмите **ENTER** в терминале

### Шаг 11: SSL сертификат

Скрипт попросит домен:

```
Enter your domain (example.com): yourdomain.com
```

Введите ваш домен (без www и https)

После этого:
1. Скрипт настроит Nginx
2. Запустит certbot для получения сертификата
3. SSL будет работать автоматически

---

# ЭТАП 4: Готово! ✅

Когда скрипт закончит, вы увидите:

```
===============================================
✅ MotoMate successfully deployed to Yandex Cloud!
===============================================

📋 Deployment Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌍 Domain: https://yourdomain.com
🖥️  Server IP: XXX.XXX.XXX.XXX
📁 Project: /home/ubuntu/motomate
🐳 Docker: ✅ Running
🗄️  PostgreSQL: ✅ Running  
🚀 Backend: ✅ Running (http://localhost:3001)
🎨 Frontend: ✅ Running (http://localhost:8080)
🔒 SSL: ✅ Installed (auto-renews)
💾 Backups: ✅ Daily at 3 AM
```

---

## ⏭️ Следующие шаги:

1. **Проверяем домен:** Откройте https://yourdomain.com в браузере
2. **Регистрируемся:** Попробуйте создать аккаунт (все 3 согласия обязательны!)
3. **Тестируем:** Чат, карта, события должны работать

---

# 🛠️ ПОЛЕЗНЫЕ КОМАНДЫ

## Проверить статус контейнеров:

```bash
cd /home/ubuntu/motomate
docker-compose ps
```

## Смотреть логи:

```bash
# Backend
docker-compose logs -f backend

# PostgreSQL
docker-compose logs -f postgres

# Выход: CTRL+C
```

## Перезагрузить контейнеры:

```bash
docker-compose restart
```

## Подключение к БД:

```bash
docker-compose exec postgres psql -U motomate_user -d motomate
```

Выход из psql: `\quit`

## Обновление приложения:

```bash
git pull origin main
docker-compose up -d --build
docker-compose exec backend npx prisma migrate deploy
```

## Ручной бэкап:

```bash
/home/ubuntu/backup.sh
```

---

# ❌ ПРОБЛЕМЫ И РЕШЕНИЯ

## Проблема: SSL сертификат не получен

```bash
# Попробуйте вручную:
sudo certbot --nginx -d yourdomain.com
```

## Проблема: Backend не запускается

```bash
# Проверяем логи
docker-compose logs backend

# Перезапускаем
docker-compose restart backend

# Проверяем миграции
docker-compose exec backend npx prisma migrate deploy
```

## Проблема: PostgreSQL не готова

```bash
# Дождитесь пока скажет "healthy"
docker-compose ps

# Если долго, перезагрузите:
docker-compose restart postgres
```

## Проблема: Сайт недоступен

```bash
# Проверяем Nginx
sudo nginx -t

# Смотрим логи Nginx
sudo tail -f /var/log/nginx/error.log

# Перезагружаем
sudo systemctl reload nginx
```

---

# 📋 ИТОГОВЫЙ CHECKLIST

- [ ] VM создана в Yandex Cloud
- [ ] Порты открыты (80, 443, 22)
- [ ] SSH подключение работает
- [ ] Скрипт запущен: `sudo bash deploy-yandex.sh`
- [ ] .env заполнен (пароли, домен)
- [ ] Скрипт завершился успешно
- [ ] Домен доступен по HTTPS
- [ ] Регистрация работает
- [ ] Чат/карта/события работают
- [ ] SSL сертификат активен

---

# 🎉 ГОТОВО!

**Ваше приложение работает на production сервере в Yandex Cloud!** 🚀

Если что-то не так — смотрите ПРОБЛЕМЫ И РЕШЕНИЯ выше.

**Успешного деплоя!**
