import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { expectAxeClean } from './axe';

const SETTING_KEYS = [
	'route_grade_system',
	'boulder_grade_system',
	'date_format',
	'unit_height',
	'unit_distance',
	'unit_temperature',
	'unit_wind',
	'unit_precipitation',
	'search_indexing',
	'show_notes',
	'counted_tick_types'
];

test('saved imperial units and US dates reach the dashboard and logbook', async ({ page }) => {
	const db = new Database('e2e/.tmp/open.sqlite');
	const keys = SETTING_KEYS.map(() => '?').join(',');
	const saved = db
		.prepare(`SELECT key, value, updated_at FROM app_settings WHERE key IN (${keys})`)
		.all(...SETTING_KEYS) as { key: string; value: string; updated_at: string }[];
	const fixtureId = 'display-settings-round-trip';
	const routeName = 'Display settings fixture';
	const day = '2026-09-17';
	const lat = 41.2;
	const lon = 84.3;
	try {
		const routeId = db
			.prepare(
				`INSERT INTO routes (provider, external_id, name, crag_name, gear_style, lat, lon, height_m, updated_at)
				 VALUES ('thecrag', ?, ?, 'Display settings crag', 'Sport', ?, ?, 1500, ?)`
			)
			.run(fixtureId, routeName, lat, lon, day).lastInsertRowid;
		db.prepare(
			`INSERT INTO ascents (provider, external_id, route_id, ascent_date, is_send, tick_type, updated_at)
			 VALUES ('thecrag', ?, ?, ?, 1, 'Red point', ?)`
		).run(fixtureId, routeId, day, day);
		db.prepare(
			`INSERT INTO weather_days
			 (lat_key, lon_key, day, temp_max_c, temp_min_c, precip_mm, weather_code, status, fetched_at)
			 VALUES (?, ?, ?, 24.9, 12, 12.7, 0, 'ok', ?)`
		).run(lat, lon, day, day);

		await page.setViewportSize({ width: 1440, height: 1000 });
		const distance = page
			.locator('.metric.panel')
			.filter({ has: page.getByText('distance climbed', { exact: true }) })
			.locator('strong');
		await page.goto('/');
		await expect(distance).toHaveText(/^\d+(?:\.\d+)? km$/);
		const kilometres = Number.parseFloat(await distance.innerText());
		expect(kilometres).toBeGreaterThan(0);
		const miles = Math.round((kilometres / 1.609344) * 10) / 10;

		await page.goto('/settings');
		const card = page.locator('article.panel').filter({
			has: page.getByRole('heading', { name: 'Display & visibility' })
		});
		await card.getByRole('button', { name: 'Imperial (US)', exact: true }).click();
		await card.getByRole('combobox', { name: 'Date format' }).selectOption('mm/dd/yyyy');
		await card.getByRole('button', { name: 'Save preferences' }).click();
		await expect(page.getByText('Preferences saved.')).toBeVisible();

		await page.reload();
		for (const [field, value] of [
			['Date format', 'mm/dd/yyyy'],
			['Height', 'ft'],
			['Distance', 'mi'],
			['Temperature', 'fahrenheit'],
			['Wind speed', 'mph'],
			['Precipitation', 'in']
		]) {
			await expect(card.getByRole('combobox', { name: field })).toHaveValue(value);
		}
		await expectAxeClean(page, { include: [card] });

		await page.goto('/');
		await expect(distance).toHaveText(`${miles} mi`);
		await page.goto(`/logbook?q=${encodeURIComponent(routeName)}`);
		const row = page.getByRole('row').filter({ hasText: routeName });
		await expect(row.getByRole('cell', { name: '09/17/2026', exact: true })).toBeVisible();
		const weather = row.locator('.weather-cell .weather-values');
		await expect(weather.getByText('High 76.8°F', { exact: true })).toBeVisible();
		await expect(weather.getByText('Rain 0.50 in', { exact: true })).toBeVisible();
		await expectAxeClean(page, { include: [row] });
	} finally {
		db.transaction(() => {
			db.prepare('DELETE FROM ascents WHERE provider = ? AND external_id = ?').run(
				'thecrag',
				fixtureId
			);
			db.prepare('DELETE FROM routes WHERE provider = ? AND external_id = ?').run(
				'thecrag',
				fixtureId
			);
			db.prepare('DELETE FROM weather_days WHERE lat_key = ? AND lon_key = ? AND day = ?').run(
				lat,
				lon,
				day
			);
			db.prepare(`DELETE FROM app_settings WHERE key IN (${keys})`).run(...SETTING_KEYS);
			const restore = db.prepare(
				'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
			);
			for (const row of saved) restore.run(row.key, row.value, row.updated_at);
		})();
		db.close();
	}
});
