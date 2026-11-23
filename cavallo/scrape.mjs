// Scraper immobiliarecavallo.it — BIG/SMA + flip. Uso: node cavallo/scrape.mjs [--headless] [--max-ads N]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));