// Scraper caasa — aggregatore BIG/SMA + flip. Uso: node caasa/scrape.mjs [--max-ads N]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));