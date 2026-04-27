# #!/bin/bash
# set -e

# echo "🚀 Starting Home Assistant Supervisor dev"

# # Nettoyage
# docker rm -f hassio_supervisor || true

# # Lancement avec toutes les variables nécessaires
# docker rm -f ha-dev || true && docker run -d \
#   --name ha-dev \
#   --privileged \
#   --network host \
#   -v /workspaces/ha-data:/config \
#   -v /workspaces/hass-addons/ttlock-hass-integration:/config/custom_components/ttlock homeassistant/home-assistant:stable

# echo "✅ Supervisor restarté avec les variables d'environnement"

#!/bin/bash
set -e

echo "🚀 Starting TTLock addon dev mode"

docker rm -f ttlock-dev || true

docker build -t ttlock-addon .

docker run --rm -it \
  --name ttlock-dev \
  --network host \
  -v "$(pwd):/app" \
  -w /app \
  ttlock-addon