// Scraper progettocasadialfaeomega.it — BIG/SMA + flip. Uso: node alfaeomega/scrape.mjs [--headless] [--max-ads N]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));