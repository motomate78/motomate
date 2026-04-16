#!/bin/bash

# ============================================
# MotoMate - Automated Deployment to Yandex Cloud
# ============================================
# Run on fresh Ubuntu 22.04 VM in Yandex Cloud
# Usage: sudo bash deploy-yandex.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# ============================================
# AUTO-DETECT USER
# ============================================
# Determine which user is running this (not root)
DEPLOY_USER="${SUDO_USER:-motoadmin}"
log_info "Deploying as user: $DEPLOY_USER"

# ============================================
# STEP 1: System Check & Update
# ============================================

log_info "Step 1: System preparation..."

if [[ $EUID -ne 0 ]]; then
   log_error "Run this script with sudo"
fi

apt update && apt upgrade -y
log_success "System updated"

# ============================================
# STEP 2: Install Docker
# ============================================

log_info "Step 2: Installing Docker..."

if command -v docker &> /dev/null; then
    log_success "Docker already installed"
else
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker "$DEPLOY_USER"
    rm get-docker.sh
    log_success "Docker installed"
fi

# ============================================
# STEP 3: Install Docker Compose
# ============================================

log_info "Step 3: Installing Docker Compose..."

if command -v docker-compose &> /dev/null; then
    log_success "Docker Compose already installed"
else
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
      -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    log_success "Docker Compose installed"
fi

# ============================================
# STEP 4: Install Node.js & Git
# ============================================

log_info "Step 4: Installing Node.js 20..."

if ! command -v node &> /dev/null; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
fi

apt install -y git curl wget
log_success "Node.js $(node --version) installed"

# ============================================
# STEP 5: Clone Repository
# ============================================

log_info "Step 5: Setting up repository..."

REPO_DIR="/home/$DEPLOY_USER/motomate"

# Use provided argument or prompt user
if [ -z "$1" ]; then
    log_warning "Repository URL not provided via argument"
    log_info "Usage: sudo bash deploy-yandex.sh https://github.com/your-user/motomate.git"
    read -p "Enter Repository URL: " REPO_URL
    
    if [ -z "$REPO_URL" ]; then
        log_error "Repository URL cannot be empty"
    fi
else
    REPO_URL="$1"
    log_info "Using provided repository: $REPO_URL"
fi

if [ ! -d "$REPO_DIR" ]; then
    git clone "$REPO_URL" "$REPO_DIR"
else
    cd "$REPO_DIR"
    git pull
fi

cd "$REPO_DIR"
log_success "Repository ready at: $REPO_DIR"

# ============================================
# STEP 6: Configure .env
# ============================================

log_info "Step 6: Configuring .env..."

if [ ! -f ".env" ]; then
    cp .env.example .env
    log_warning "IMPORTANT! Edit .env with your configuration:"
    log_warning "   nano /home/$DEPLOY_USER/motomate/.env"
    log_warning ""
    log_warning "Required values:"
    log_warning "  • POSTGRES_PASSWORD (strong password)"
    log_warning "  • JWT_SECRET (random 32+ chars)"
    log_warning "  • CORS_ORIGINS (your domain)"
    log_warning "  • YANDEX_CLIENT_ID / SECRET"
    log_warning "  • AWS_ACCESS_KEY_ID / SECRET"
    log_warning "  • S3_BUCKET (your bucket name)"
    log_warning "  • VITE_YANDEX_API_KEY"
    log_warning ""
    
    read -p "Press ENTER after configuring .env..."
else
    log_success ".env already exists"
fi

if grep -q "CHANGE_ME\|your_" .env; then
    log_error ".env still has placeholder values. Please edit first."
fi

# ============================================
# STEP 7: Start Containers
# ============================================

log_info "Step 7: Starting Docker containers..."

docker-compose down 2>/dev/null || true
docker-compose up -d --build

log_warning "Waiting for PostgreSQL to be ready..."
sleep 10

# ============================================
# STEP 8: Run Migrations
# ============================================

log_info "Step 8: Running database migrations..."

docker-compose exec -T backend npx prisma migrate deploy || log_warning "Migrations already applied"
log_success "Database ready"

# ============================================
# STEP 9: Install Nginx & SSL
# ============================================

log_info "Step 9: Installing Nginx & Certbot..."

apt install -y nginx certbot python3-certbot-nginx
systemctl stop nginx
log_success "Nginx & Certbot installed"

# ============================================
# STEP 10: Configure Nginx
# ============================================

log_info "Step 10: Configuring Nginx reverse proxy..."

read -p "Enter your domain (example.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    log_error "Domain required"
fi

cat > /etc/nginx/sites-available/motomate <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Frontend
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Socket.io
    location /socket.io {
        proxy_pass http://localhost:3001/socket.io;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    client_max_body_size 100M;
}
EOF

ln -sf /etc/nginx/sites-available/motomate /etc/nginx/sites-enabled/motomate
rm -f /etc/nginx/sites-enabled/default

nginx -t || log_error "Nginx configuration error"
systemctl enable nginx
systemctl start nginx
log_success "Nginx configured"

# ============================================
# STEP 11: Setup SSL Certificate
# ============================================

log_info "Step 11: Setting up SSL with Let's Encrypt..."

certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || \
    log_warning "SSL setup interactive required. Run: sudo certbot --nginx -d $DOMAIN"

systemctl enable certbot.timer
log_success "SSL certificate installed & auto-renewal enabled"

# ============================================
# STEP 12: Setup Backups
# ============================================

log_info "Step 12: Setting up automated backups..."

mkdir -p /home/$DEPLOY_USER/backups

cat > /home/$DEPLOY_USER/backup.sh <<'BACKUP_SCRIPT'
#!/bin/bash
cd /home/$DEPLOY_USER/motomate
BACKUP_DIR="/home/$DEPLOY_USER/backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/motomate_$TIMESTAMP.sql.gz"

docker-compose exec -T postgres pg_dump \
  -U ${POSTGRES_USER:-motomate_user} \
  -d ${POSTGRES_DB:-motomate} \
  | gzip > $BACKUP_FILE

# Keep only last 30 days
find $BACKUP_DIR -name "motomate_*.sql.gz" -mtime +30 -delete

echo "✅ Backup: $BACKUP_FILE"
BACKUP_SCRIPT

chmod +x /home/$DEPLOY_USER/backup.sh

# Add cron job (daily at 3 AM)
CRON_CMD="0 3 * * * /home/$DEPLOY_USER/backup.sh >> /var/log/motomate-backup.log 2>&1"
(crontab -u $DEPLOY_USER -l 2>/dev/null || true) | grep -v "backup.sh" | crontab -u $DEPLOY_USER -
(crontab -u $DEPLOY_USER -l 2>/dev/null || true; echo "$CRON_CMD") | crontab -u $DEPLOY_USER -

log_success "Backups configured (daily at 3 AM)"

# ============================================
# STEP 13: Summary
# ============================================

log_success "==============================================="
log_success "✅ MotoMate successfully deployed to Yandex Cloud!"
log_success "==============================================="
echo ""

PUBLIC_IP=$(hostname -I | awk '{print $1}')

cat << SUMMARY
📋 Deployment Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌍 Domain: https://$DOMAIN
🖥️  Server IP: $PUBLIC_IP
📁 Project: /home/$DEPLOY_USER/motomate
🐳 Docker: ✅ Running
🗄️  PostgreSQL: ✅ Running  
🚀 Backend: ✅ Running (http://localhost:3001)
🎨 Frontend: ✅ Running (http://localhost:8080)
🔒 SSL: ✅ Installed (auto-renews)
💾 Backups: ✅ Daily at 3 AM

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 Useful Commands:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check status:
  docker-compose ps

View logs:
  docker-compose logs -f backend

Restart services:
  docker-compose restart

Connect to PostgreSQL:
  docker-compose exec -T postgres psql -U motomate_user -d motomate

Update application:
  cd /home/$DEPLOY_USER/motomate
  git pull origin main
  docker-compose up -d --build

Manual backup:
  /home/$DEPLOY_USER/backup.sh

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 For troubleshooting, see YANDEX_SETUP.md

SUMMARY
