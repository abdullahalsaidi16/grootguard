#!/bin/sh
# Open-Meteo rate-limits a ten-year request hard. Every point is cached, so
# restarting resumes; keep restarting until the stage completes.
i=1
while [ $i -le 40 ]; do
  echo "--- weather attempt $i ---"
  if .venv/bin/python -u -m pipeline.weather; then
    echo "--- weather COMPLETE on attempt $i ---"; exit 0
  fi
  echo "--- attempt $i failed, pausing 60s ---"; sleep 60
  i=$((i+1))
done
echo "--- weather gave up after $i attempts ---"; exit 1
