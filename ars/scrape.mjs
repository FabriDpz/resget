// Scraper arsimmobiliare.com — BIG/SMA + flip. Uso: node ars/scrape.mjs [--headless] [--max-ads N] [--resume]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));