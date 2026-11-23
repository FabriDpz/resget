// Scraper Casa.it — usa il runner condiviso.
// Uso: node casait/scrape.mjs [--headless] [--max-ads 200] [--resume <json>]
import { runPortal } from '../core/runner.mjs';
import adapter from './adapter.mjs';
runPortal(adapter, import.meta.url, process.argv.slice(2));