#!/usr/bin/env bash
# Подготовка чистого Ubuntu 24.04 под «Личности» (идемпотентно: повторный запуск безопасен).
# Запуск:  ssh root@SERVER 'bash -s' < infra/server/bootstrap.sh
# Делает: очистку (nginx, MariaDB, старые логи), защиту (SSH только по ключам, ufw, fail2ban,
# автообновления безопасности), swap 2 ГБ, Docker + compose. Пользовательские SSH-ключи не трогает.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { printf '\n=== %s\n' "$*"; }

log "1. Очистка: nginx и MariaDB (проекту не нужны — веб-сервер и PostgreSQL в Docker)"
systemctl disable --now nginx mariadb 2>/dev/null || true
apt-get purge -y -q 'nginx*' 'mariadb-*' 'mysql-*' >/dev/null 2>&1 || true
apt-get autoremove -y -q --purge >/dev/null
rm -rf /var/www/html /etc/nginx /var/lib/mysql /etc/mysql

log "2. Логи: удалить старые, ограничить журнал"
journalctl --vacuum-size=200M >/dev/null
rm -f /var/log/syslog.[0-9]* /var/log/*.gz /var/log/*.[0-9]
: > /var/log/syslog
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/lichnosti.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=1month
EOF
systemctl restart systemd-journald

log "3. Остатки прошлых сессий"
rm -rf /root/.claude /root/.ansible /root/.cache /root/.lesshst
: > /root/.bash_history

log "4. Пакеты и автообновления безопасности"
apt-get update -q >/dev/null
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null

log "5. SSH: только по ключам (вход по паролю отключён)"
cat > /etc/ssh/sshd_config.d/00-lichnosti.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh

log "6. Файрвол: SSH, HTTP, HTTPS; агент мониторинга хостинга — только с его адресов"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
for ip in 92.53.116.12 92.53.116.111 92.53.116.119; do ufw allow from "$ip" to any port 10050 proto tcp >/dev/null; done
ufw --force enable >/dev/null
ufw status | head -20

log "7. fail2ban для SSH"
cat > /etc/fail2ban/jail.d/lichnosti.conf <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

log "8. Swap 2 ГБ"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-lichnosti.conf

log "9. Docker Engine + compose (официальный репозиторий)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q >/dev/null
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "3" } }
EOF
systemctl enable --now docker >/dev/null
systemctl restart docker
docker --version && docker compose version

log "Готово"
free -h | head -3
df -h / | tail -1
