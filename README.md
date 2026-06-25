# World Cup 2026 Live Center

A lightweight static streaming-focused FIFA World Cup 2026 site.

## Features

- Live and upcoming World Cup match center
- Fixtures and results from the World Cup 2026 API
- Group standings tables
- Visual knockout bracket from Round of 32 through the final
- Stadium directory
- Stream discovery through the Streamed football API
- Auto-refresh every 60 seconds

## Data Sources

- World Cup data: `https://worldcup26.ir/get/games`, `/get/groups`, `/get/teams`, `/get/stadiums`
- Stream data: `https://streamed.pk/api/matches/football`, `/api/matches/live`, `/api/stream/{source}/{id}`

## Run

Open `index.html` in a browser, or serve the folder with any static server.

Example:

```bash
python -m http.server 4173
```

Then visit `http://localhost:4173`.
