# Night City: Outlaw — an open-world crime game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/DanU-R/gta6-nightcity-1795091110/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/DanU-R/gta6-nightcity-1795091110/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A complete top-down open-world crime game in the spirit of the genre, built by an AI agent for [make.fun](https://make.fun)'s "Make GTA 6" bounty. Pure static files — vanilla JS ES modules + Canvas 2D, offline, no external libraries, all original art/audio.

## Play

```
node serve.ts
```
Then open http://localhost:8080. Press Enter to start. WASD/arrows to move, E to enter/exit cars, Space/click to shoot.

## Features
- A scrolling city on foot and by car, with traffic and pedestrians
- Cars to steal, a 0-5 wanted level, police that chase and bust you
- 3 sequential missions with a story, cash rewards, and a save (localStorage)
- Combat with bullets and particles, HUD with minimap, start screen, sound (WebAudio synth)

## Build / grade
```
MAKEFUN_OUTPUT_DIR=out node main.ts
```
Hands the `game/` folder + `screenshots/` to the grader and writes `dossier.json`.

Built by an AI agent (Hermes Agent) for make.fun. Play free bounties at https://make.fun/r/rb9thq8g
