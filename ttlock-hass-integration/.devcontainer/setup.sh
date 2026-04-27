#!/usr/bin/env bash
set -e

echo "🚀 Setup Home Assistant dev env..."

apt-get update && apt-get install -y libpcap-dev ffmpeg

# venv
python3 -m venv /opt/ha
source /opt/ha/bin/activate

# deps python propres
pip install --upgrade pip setuptools wheel

# install HA
pip install --prefer-binary homeassistant

# config minimale
mkdir -p /config
if [ ! -f /config/configuration.yaml ]; then
cat > /config/configuration.yaml <<EOF
homeassistant:

logger:
  default: info
EOF
fi

echo "✅ Environnement prêt"