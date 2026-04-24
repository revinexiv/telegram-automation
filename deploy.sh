#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Script deploy otomatis ke VPS/Oracle Cloud (Ubuntu 22.04)
# Jalankan SEKALI saja di server baru:
#   chmod +x deploy.sh && ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Stop on error

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  TG Auto System - Deployment Setup   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. Update System ────────────────────────────────────────────────────────
echo "📦 Updating system..."
sudo apt-get update -y
sudo apt-get upgrade -y

# ─── 2. Install Docker ───────────────────────────────────────────────────────
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# Install Docker Compose plugin
if ! command -v docker compose &> /dev/null; then
    sudo apt-get install -y docker-compose-plugin
fi

# ─── 3. Install git ──────────────────────────────────────────────────────────
sudo apt-get install -y git

# ─── 4. Clone / Copy project ─────────────────────────────────────────────────
PROJECT_DIR="$HOME/tg-auto-system"
if [ ! -d "$PROJECT_DIR" ]; then
    echo "📁 Creating project directory..."
    mkdir -p "$PROJECT_DIR"
fi
echo "✅ Project dir: $PROJECT_DIR"

# ─── 5. Setup .env ───────────────────────────────────────────────────────────
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo ""
    echo "⚙️  Setup Environment Variables"
    echo "────────────────────────────────"
    
    read -p "Masukkan TELEGRAM_API_ID: " API_ID
    read -p "Masukkan TELEGRAM_API_HASH: " API_HASH
    
    # Generate secret key
    SECRET_KEY=$(python3 -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())")
    
    read -p "Admin Username [admin]: " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}
    
    read -s -p "Admin Password: " ADMIN_PASS
    echo ""
    
    cat > "$PROJECT_DIR/.env" << EOF
TELEGRAM_API_ID=$API_ID
TELEGRAM_API_HASH=$API_HASH
SECRET_KEY=$SECRET_KEY
ADMIN_USERNAME=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASS
DATABASE_URL=sqlite+aiosqlite:///./data/telegram_auto.db
HOST=0.0.0.0
PORT=8000
EOF
    echo "✅ .env file created"
fi

# ─── 6. Create directories ───────────────────────────────────────────────────
mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/sessions" "$PROJECT_DIR/media" "$PROJECT_DIR/certbot"

# ─── 7. Configure Firewall ───────────────────────────────────────────────────
echo "🔥 Configuring firewall..."
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw --force enable
echo "✅ Firewall configured"

# ─── 8. Build and Start ──────────────────────────────────────────────────────
echo ""
echo "🚀 Building and starting containers..."
cd "$PROJECT_DIR"
sudo docker compose up -d --build

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Deployment Berhasil!                     ║"
echo "╠══════════════════════════════════════════════╣"

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "║  Dashboard: http://$SERVER_IP"
echo "║                                              ║"
echo "║  Perintah berguna:                           ║"
echo "║  docker compose logs -f     # Live logs      ║"
echo "║  docker compose restart     # Restart        ║"
echo "║  docker compose down        # Stop           ║"
echo "╚══════════════════════════════════════════════╝"
