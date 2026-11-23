// Scraper 1000case.it (API Supabase pura) — BIG/SMA + flip. Uso: node millecase/scrape.mjs [--max-ads N]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));