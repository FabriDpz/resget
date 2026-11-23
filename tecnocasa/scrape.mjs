// Scraper tecnocasa.it — BIG/SMA + flip. Uso: node tecnocasa/scrape.mjs [--max-ads N] [--resume]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));