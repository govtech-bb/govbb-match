# opportunities-platform

Two vanilla prototype apps sharing one JSON API.

- `admin/` — manage list of opportunities (CRUD)
- `matcher/` — user answers personalized questions, gets ranked matches
- `data/opportunities.json` — single source of truth (swap for DB later)
- `server.js` — vanilla Node http server, no dependencies

## Run

```sh
node server.js
```

Open:
- http://localhost:4000/admin/
- http://localhost:4000/matcher/

## API

| Method | Path | Body | Use |
|--------|------|------|-----|
| GET | `/api/opportunities` | — | list all |
| POST | `/api/opportunities` | `{title, category, description, tags[], eligibility{ageMin,ageMax,citizenship,interests[]}, deadline, url}` | create |
| DELETE | `/api/opportunities/:id` | — | remove |
| POST | `/api/match` | `{age, citizenship, interests[]}` | ranked matches |

CORS enabled — any other prototype app can call the API directly.

## Design system

GovBB design system loaded via CDN:
`https://unpkg.com/@govtech-bb/styles@1.0.0-alpha.16/dist/styles.css`

Light overrides in `public/shared/styles.css`.

## Next

- Paste scrape list into `data/opportunities.json`
- Add more questions in `matcher/index.html` + scoring in `server.js#scoreOpp`
