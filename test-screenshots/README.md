# Test screenshots

`npm run test:e2e` (Playwright) writes three screenshots here so you can eyeball the
rendered app:

- `solar.png` - the full solar view (KPIs, map, charts)
- `battery.png` - the full battery view (units in kWh/GWh, time range from Jul 2025)
- `vintage.png` - the installation-vintage / waste-arisings chart

To generate them on your machine:

```bash
npx playwright install chromium   # one-time: download the browser
npm run test:e2e
```

The PNGs are git-ignored (they are build output, regenerated on demand).
