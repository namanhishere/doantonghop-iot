#!/bin/bash
cd /home/namanhishere/doantonghop-iot/boardCam



echo "Start flask"
. venv/bin/activate
(python index.py > log 2>&1) &
FLASK_PID=$!
deactivate
sleep 5

echo "Flask PID: $FLASK_PID"
trap "echo '... Stop flask (PID: $FLASK_PID) ...'; kill $FLASK_PID; echo '... stoped.';" EXIT
echo "Start firefox"

sudo -u namanhishere DISPLAY=:0 firefox --kiosk http://localhost:5000
