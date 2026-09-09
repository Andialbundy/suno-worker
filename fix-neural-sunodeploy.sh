#!/bin/bash
# Fix: CHROME_PROFILE env var name → CHROME_PROFILE_DIR in systemd service
# Run this on neuralnode: ssh <user>@<neuralnode> then bash fix-neural-sunodeploy.sh

echo "Updating suno-worker.service..."
cat > /etc/systemd/system/suno-worker.service << 'SERVICE'
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
SERVICE

echo "Reloading systemd..."
systemctl daemon-reload
systemctl restart suno-worker.timer
systemctl status suno-worker.timer --no-pager
echo "Done. Timer should now use correct profile path."
