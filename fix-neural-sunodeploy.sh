#!/bin/bash
# Fix: Update suno-worker.service on neuralnode with CHROME_PROFILE_DIR
# Run via SSH or directly on neuralnode

echo "Updating suno-worker.service..."
sudo bash -c 'cat > /etc/systemd/system/suno-worker.service << SERVICE
[Unit]
Description=Suno worker job poll
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker run --rm --env-file /home/crd-remote/suno-worker/.env \
  -e CHROME_BIN=/usr/bin/google-chrome \
  -e CHROME_PROFILE_DIR=/root/chrome-profile \
  -v /home/crd-remote/suno-chrome-profile:/root/chrome-profile \
  suno-worker:chrome
SERVICE'

echo "Reloading systemd..."
sudo systemctl daemon-reload
sudo systemctl restart suno-worker.timer
sudo systemctl status suno-worker.timer --no-pager
echo "Done. Timer should now use correct profile path."
