// Scraper Subito.it — BIG/SMA + flip (list-only). Uso: node subito/scrape.mjs [--headless] [--max-ads N] [--resume]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));