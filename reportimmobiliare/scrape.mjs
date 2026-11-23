// Scraper reportimmobiliare.it — BIG/SMA + flip. Uso: node reportimmobiliare/scrape.mjs [--headless] [--max-ads N]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));