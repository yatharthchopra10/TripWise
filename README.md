# ✈️ TripWise – Smart Travel Planner

**Track:** Frontend Development
**Submission for:** AWS Student Builder Group, VIT Chennai – Web Development Recruitment Task

TripWise lets you explore destinations around the world, view useful details (including a live weather forecast), and build a personal itinerary that survives page refreshes.

**Live demo:** `https://yatharthchopra10.github.io/TripWise/#explore`
**Repository:** `https://github.com/yatharthchopra10/TripWise`

## Features

- **Destination exploration** – responsive card grid of ~250 countries with flag, capital, region and population.
- **Search, filter, sort** – search by country or capital, filter by region, sort by name, population or area.
- **Destination details** – dialog with official name, capital, population, area, languages, currency, timezones, neighbours, driving side, a Google Maps link and a 3-day weather forecast for the capital.
- **Itinerary management** – add / remove from cards or the details dialog, reorder with ↑ ↓, and write a note for each stop.
- **Persistence** – the itinerary is saved in `localStorage`, so it remains after refresh.
- **Resilient data loading** – 12s timeout, backup data source, and local cache.
- **Polished UI** – glassmorphism, animated aurora background, dark/light theme, region chips, "Surprise me", pagination, timeline style itinerary, copy/download export.
- **Reliable feedback** – skeleton loading cards, empty states (no search results, empty trip), error states with Retry buttons, and toast notifications.
- **Responsive and accessible** – works on desktop and mobile, supports light/dark mode, keyboard focus styles, ARIA labels.

## Tech stack

Plain HTML, CSS and JavaScript (ES6+). No build step, no dependencies, no API keys.

## APIs used

| API | Purpose | Key needed? |
| --- | --- | --- |
| [REST Countries v3.1](https://restcountries.com) | Destination list and details (`/all`, `/alpha/{code}`) | No |
| [Open-Meteo](https://open-meteo.com) | Current weather and 3-day forecast | No |

If REST Countries is unreachable, the app automatically falls back to an open data mirror ([mledoze/countries](https://github.com/mledoze/countries) via jsDelivr) and then to the last cached response, so the UI never breaks during a demo.

Both main APIs are free for non-commercial use and are credited in the app footer. Open-Meteo requires attribution (CC BY 4.0), which the footer provides.

## Run locally

```bash
git clone <https://github.com/yatharthchopra10/TripWise>
cd tripwise
# option 1: just open index.html in a browser
# option 2: serve it
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project structure

```
index.html   page structure (Explore view, My Trip view, details dialog)
style.css    responsive styles, light/dark theme
app.js       API calls, search/filter/sort, itinerary + localStorage logic
```

## Database configuration

Not applicable for the Frontend track – the itinerary uses browser `localStorage` (key: `tripwise.itinerary.v1`).
